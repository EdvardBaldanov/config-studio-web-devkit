/**
 * Web DevKit Plugin for Config Studio v1.2.0
 * Provides Live HTML/PHP Preview with Browser Chrome Simulation,
 * AST Outline parsers, Monaco autocompletions and host server integration.
 */
(function() {
  const pluginId = 'web-devkit';
  if (!window.ConfigStudio) {
    console.warn('[WebDevKit] ConfigStudio API not found.');
    return;
  }

  let previewActive = false;
  let serverProcess = null;
  let serverPort = 8085;
  let deviceMode = 'responsive'; // 'responsive', 'desktop', 'tablet', 'mobile'

  const isWebFile = (path) => {
    if (!path) return false;
    const lower = path.toLowerCase();
    return lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xhtml') || lower.endsWith('.php') || lower.endsWith('.phtml') || lower.endsWith('.svg');
  };

  // ==========================================================================
  // 1. AST Outline Providers for HTML and PHP
  // ==========================================================================
  function buildLineOffsets(content) {
    const offsets = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  function getLineNumber(offsets, pos) {
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (offsets[mid] <= pos) {
        if (mid === offsets.length - 1 || offsets[mid + 1] > pos) {
          return mid + 1;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return 1;
  }

  const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype'
  ]);

  function parseHtmlOutline(content, filename) {
    const lineOffsets = buildLineOffsets(content);
    const outline = [];
    let idCounter = 0;

    const stack = [];
    const tagRegex = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9\-:]+)\s*>|<(!?[a-zA-Z0-9\-:]+)((?:\s+[^>]*?)?)(\/?)>/g;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const fullMatch = match[0];
      const matchIndex = match.index;
      const lineNumber = getLineNumber(lineOffsets, matchIndex);

      if (fullMatch.startsWith('<!--')) continue;

      if (match[1]) {
        const closeTag = match[1].toLowerCase();
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === closeTag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }

      const rawTag = match[2];
      if (!rawTag) continue;
      const tag = rawTag.toLowerCase();
      const attrsStr = match[3] || '';
      const isSelfClosing = match[4] === '/' || VOID_ELEMENTS.has(tag);

      const idMatch = attrsStr.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const idVal = idMatch ? (idMatch[1] ?? idMatch[2] ?? idMatch[3]) : '';

      const classMatch = attrsStr.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const classVal = classMatch ? (classMatch[1] ?? classMatch[2] ?? classMatch[3]) : '';

      const isHeading = /^h[1-6]$/.test(tag);
      const isLandmark = /^(header|nav|main|section|article|aside|footer|form)$/.test(tag);
      const isRoot = /^(html|head|body)$/.test(tag);
      const isImportantControl = /^(button|input|select|textarea|table|dialog|template)$/.test(tag);
      const isScriptOrStyle = /^(script|style|title)$/.test(tag);
      const isCustomTag = tag.includes('-');

      const shouldInclude =
        isRoot || isLandmark || isHeading || Boolean(idVal) || isImportantControl ||
        isScriptOrStyle || isCustomTag || (tag === 'div' && (Boolean(idVal) || Boolean(classVal)));

      if (!shouldInclude) continue;

      let label = `<${tag}>`;
      if (isHeading) {
        const afterTag = content.slice(matchIndex + fullMatch.length, matchIndex + fullMatch.length + 80);
        const textMatch = afterTag.match(/^([^<]+)/);
        const headingText = textMatch ? textMatch[1].trim() : '';
        label = `${tag.toUpperCase()}: ${headingText ? (headingText.length > 20 ? headingText.slice(0, 20) + '…' : headingText) : tag}`;
      } else if (tag === 'title') {
        const afterTag = content.slice(matchIndex + fullMatch.length, matchIndex + fullMatch.length + 80);
        const textMatch = afterTag.match(/^([^<]+)/);
        const titleText = textMatch ? textMatch[1].trim() : '';
        label = `<title>: ${titleText ? (titleText.length > 18 ? titleText.slice(0, 18) + '…' : titleText) : 'Document'}`;
      } else if (idVal) {
        label = `<${tag}#${idVal}>`;
      } else if (classVal) {
        const firstClass = classVal.split(/\s+/).filter(Boolean)[0] || '';
        label = `<${tag}.${firstClass}>`;
      }

      const node = {
        id: `html_${idCounter++}`,
        label: label,
        name: label,
        type: isHeading || isLandmark ? 'section' : isImportantControl ? 'string' : 'object',
        kind: isHeading || isLandmark ? 'section' : isImportantControl ? 'string' : 'object',
        line: lineNumber,
        children: isSelfClosing ? undefined : []
      };

      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        outline.push(node);
      }

      if (!isSelfClosing) {
        stack.push({ tag, node });
      }
    }

    return outline;
  }

  function parsePhpOutline(content, filename) {
    const outline = [];
    let idCounter = 0;
    const lines = content.split('\n');
    let currentClassNode = null;
    let inClassBraceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      const nsMatch = trimmed.match(/^namespace\s+([^;{]+)/);
      if (nsMatch) {
        outline.push({
          id: `php_${idCounter++}`,
          label: `namespace ${nsMatch[1].trim()}`,
          name: `namespace ${nsMatch[1].trim()}`,
          type: 'section',
          kind: 'section',
          line: lineNum
        });
        continue;
      }

      const classMatch = trimmed.match(/^(?:(?:abstract|final|readonly)\s+)*(class|interface|trait)\s+([a-zA-Z0-9_]+)/i);
      if (classMatch) {
        const kind = classMatch[1].toLowerCase();
        const name = classMatch[2];
        currentClassNode = {
          id: `php_${idCounter++}`,
          label: `${kind} ${name}`,
          name: `${kind} ${name}`,
          type: 'section',
          kind: 'class',
          line: lineNum,
          children: []
        };
        outline.push(currentClassNode);
        inClassBraceDepth = 0;
        continue;
      }

      if (currentClassNode) {
        const openCount = (line.match(/{/g) || []).length;
        const closeCount = (line.match(/}/g) || []).length;
        inClassBraceDepth += openCount - closeCount;

        const methodMatch = trimmed.match(/^(?:(public|protected|private)\s+)?(?:(static)\s+)?function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/i);
        if (methodMatch) {
          const methodName = methodMatch[3];
          const params = methodMatch[4].trim();
          currentClassNode.children.push({
            id: `php_${idCounter++}`,
            label: `${methodName}(${params.length > 15 ? params.slice(0, 15) + '…' : params})`,
            name: `${methodName}(${params.length > 15 ? params.slice(0, 15) + '…' : params})`,
            type: 'section',
            kind: 'function',
            line: lineNum
          });
          continue;
        }

        if (inClassBraceDepth <= 0 && i > currentClassNode.line - 1) {
          currentClassNode = null;
        }
      } else {
        const funcMatch = trimmed.match(/^function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/i);
        if (funcMatch) {
          outline.push({
            id: `php_${idCounter++}`,
            label: `function ${funcMatch[1]}()`,
            name: `function ${funcMatch[1]}()`,
            type: 'section',
            kind: 'function',
            line: lineNum
          });
        }
      }
    }

    if (content.includes('<html') || content.includes('<body') || content.includes('<div')) {
      const htmlNodes = parseHtmlOutline(content, filename);
      if (htmlNodes.length > 0) {
        if (outline.length > 0) {
          return [
            {
              id: `php_symbols_${idCounter++}`,
              label: '🐘 PHP Символы',
              name: '🐘 PHP Символы',
              type: 'section',
              kind: 'section',
              line: outline[0].line,
              children: outline
            },
            ...htmlNodes
          ];
        }
        return htmlNodes;
      }
    }

    return outline;
  }

  // Register with Core
  try {
    if (typeof window.ConfigStudio.registerOutlineProvider === 'function') {
      window.ConfigStudio.registerOutlineProvider({ language: 'html', parse: parseHtmlOutline });
      window.ConfigStudio.registerOutlineProvider({ language: 'htm', parse: parseHtmlOutline });
      window.ConfigStudio.registerOutlineProvider({ language: 'php', parse: parsePhpOutline });
      window.ConfigStudio.registerOutlineProvider({ language: 'phtml', parse: parsePhpOutline });
      window.ConfigStudio.registerOutlineProvider({ language: 'svg', parse: parseHtmlOutline });
    }
  } catch (e) {
    console.warn('[WebDevKit] registerOutlineProvider error:', e);
  }

  // ==========================================================================
  // 2. Monaco Autocomplete Providers for HTML & PHP
  // ==========================================================================
  try {
    const htmlProvider = {
      triggerCharacters: ['<', '!', ' ', '.'],
      provideCompletionItems: function(model, position) {
        const monaco = window.ConfigStudio.getMonaco();
        const kind = monaco ? monaco.languages.CompletionItemKind.Snippet : 27;
        const suggestions = [
          {
            label: 'html5',
            kind: kind,
            insertText: '<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${1:Document}</title>\n  <script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body class="bg-gray-900 text-white p-8">\n  <h1 class="text-3xl font-bold mb-4">${2:Привет, мир!}</h1>\n  <p>${0}</p>\n</body>\n</html>',
            insertTextRules: 4,
            documentation: 'HTML5 шаблон со стилями Tailwind CDN'
          },
          { label: 'div', kind: kind, insertText: '<div class="${1}">${0}</div>', insertTextRules: 4, documentation: 'HTML <div> контейнер' },
          { label: 'button', kind: kind, insertText: '<button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium ${1}">${0:Кнопка}</button>', insertTextRules: 4, documentation: 'HTML <button>' },
          { label: 'form', kind: kind, insertText: '<form action="${1}" method="${2:POST}">\n  ${0}\n</form>', insertTextRules: 4, documentation: 'HTML <form>' },
          { label: 'input', kind: kind, insertText: '<input type="${1:text}" name="${2}" placeholder="${3}" class="border rounded px-3 py-1.5 ${4}" />', insertTextRules: 4, documentation: 'HTML <input>' },
          { label: 'script', kind: kind, insertText: '<script>\n  ${0}\n</script>', insertTextRules: 4, documentation: 'HTML <script>' },
          { label: 'style', kind: kind, insertText: '<style>\n  ${0}\n</style>', insertTextRules: 4, documentation: 'HTML <style>' }
        ];
        return { suggestions };
      }
    };
    window.ConfigStudio.registerCompletionProvider('html', htmlProvider);

    const phpProvider = {
      triggerCharacters: ['$', '>', ':', ' '],
      provideCompletionItems: function(model, position) {
        const monaco = window.ConfigStudio.getMonaco();
        const kind = monaco ? monaco.languages.CompletionItemKind.Snippet : 27;
        const funcKind = monaco ? monaco.languages.CompletionItemKind.Function : 1;
        const suggestions = [
          { label: '<?php', kind: kind, insertText: '<?php\n\n${0}\n', insertTextRules: 4, documentation: 'PHP тег открытия' },
          { label: '<?= ?>', kind: kind, insertText: '<?= ${1:\\$var} ?>', insertTextRules: 4, documentation: 'Короткий вывод PHP' },
          { label: 'echo', kind: kind, insertText: 'echo "${1:Hello, World!}\\n";', insertTextRules: 4, documentation: 'Вывод текста' },
          { label: 'var_dump', kind: funcKind, insertText: 'var_dump(${1:\\$var});', insertTextRules: 4, documentation: 'Дамп переменной' },
          { label: 'json_encode', kind: funcKind, insertText: 'json_encode(${1:\\$data}, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);', insertTextRules: 4, documentation: 'Преобразование в JSON' },
          { label: 'json_decode', kind: funcKind, insertText: 'json_decode(${1:\\$json}, true);', insertTextRules: 4, documentation: 'Декодирование JSON' },
          { label: 'foreach', kind: kind, insertText: 'foreach (${1:\\$items} as ${2:\\$item}) {\n    ${0}\n}', insertTextRules: 4, documentation: 'Цикл foreach' }
        ];
        return { suggestions };
      }
    };
    window.ConfigStudio.registerCompletionProvider('php', phpProvider);
  } catch (err) {
    console.warn('[WebDevKit] Error setting up completions:', err);
  }

  // ==========================================================================
  // 3. UI Buttons, Context Menu and Toolbar Integration
  // ==========================================================================
  const WEB_EXTENSIONS = ['.html', '.htm', '.xhtml', '.php', '.phtml', '.svg', '.vue'];

  function isWebFile(file) {
    if (!file) return false;
    const name = typeof file === 'string' ? file : (file.name || file.path || '');
    if (!name) return false;
    const lower = name.toLowerCase();
    return WEB_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  window.ConfigStudio.registerToolbarButton({
    id: 'web-devkit-preview-btn',
    pluginId: pluginId,
    label: 'Live Preview',
    title: 'Web DevKit — Живой предпросмотр HTML/PHP с браузерной вкладкой Chrome',
    icon: 'globe',
    fileMatches: ['*.html', '*.htm', '*.xhtml', '*.php', '*.phtml', '*.svg', '*.vue', '.html', '.htm', '.xhtml', '.php', '.phtml', '.svg', '.vue'],
    visible: (file) => isWebFile(file),
    onClick: () => togglePreview()
  });

  if (typeof window.ConfigStudio.registerContextMenu === 'function') {
    window.ConfigStudio.registerContextMenu({
      id: 'web-devkit-open-preview',
      label: 'Открыть в Web DevKit Preview',
      icon: 'globe',
      group: 'open',
      order: 15,
      fileMatches: ['.html', '.htm', '.xhtml', '.php', '.phtml', '.svg'],
      targetType: 'file',
      onClick: async () => {
        if (!previewActive) togglePreview();
      }
    });
  }

  function togglePreview() {
    previewActive = !previewActive;
    window.ConfigStudio.toggleSplitPanel({
      id: 'web-devkit-preview-panel',
      pluginId: pluginId,
      title: 'Web DevKit — Предпросмотр',
      open: previewActive,
      render: (container) => renderPreviewUI(container)
    });
  }

  // Helper to extract <title> and favicon from content
  function extractPageMeta(content) {
    if (!content) return { title: 'Document', favicon: null };
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Document';

    const favMatch = content.match(/<link[^>]+rel=["']?(?:shortcut )?icon["']?[^>]+href=["']?([^"'>\s]+)["']?/i);
    const favicon = favMatch ? favMatch[1] : null;

    return { title, favicon };
  }

  function renderPreviewUI(container) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'web-devkit-container flex flex-col h-full w-full bg-base-surface text-xs select-none';

    const file = window.ConfigStudio.getActiveFile();
    const hasWebFile = file && isWebFile(file.path);
    const meta = extractPageMeta(file ? file.content : '');

    // ========================================================================
    // Browser Chrome Window Bar (Edge/Chrome style tab + address bar)
    // ========================================================================
    const browserBar = document.createElement('div');
    browserBar.className = 'bg-[#1e1e2e] border-b border-gray-700/80 flex flex-col';

    // 1. Chrome Tab Strip
    const tabStrip = document.createElement('div');
    tabStrip.className = 'flex items-center justify-between px-3 pt-2 bg-[#181825] border-b border-gray-800';

    const tab = document.createElement('div');
    tab.className = 'flex items-center gap-2 px-3 py-1.5 bg-[#1e1e2e] border-t-2 border-accent text-gray-200 rounded-t-lg max-w-[240px] truncate text-xs shadow-sm font-medium';
    tab.innerHTML = `
      <span class="text-sm shrink-0">${meta.favicon ? `<img src="${meta.favicon}" class="w-3.5 h-3.5 inline-block" onerror="this.outerHTML='🌐'" />` : '🌐'}</span>
      <span class="truncate">${meta.title}</span>
    `;
    tabStrip.appendChild(tab);

    // Device size switcher buttons in tab strip
    const deviceControls = document.createElement('div');
    deviceControls.className = 'flex items-center gap-1 pb-1';

    const createDeviceBtn = (mode, label, title) => {
      const btn = document.createElement('button');
      btn.className = 'px-1.5 py-0.5 rounded text-[10px] transition font-medium ' + 
        (deviceMode === mode ? 'bg-accent text-gray-900 font-bold' : 'hover:bg-gray-800 text-gray-400');
      btn.textContent = label;
      btn.title = title;
      btn.onclick = () => {
        deviceMode = mode;
        updateFrameSize();
        renderPreviewUI(container);
      };
      return btn;
    };

    deviceControls.appendChild(createDeviceBtn('responsive', 'Full', 'Полная ширина'));
    deviceControls.appendChild(createDeviceBtn('desktop', '1280', 'Desktop (1280px)'));
    deviceControls.appendChild(createDeviceBtn('tablet', '768', 'Tablet (768px)'));
    deviceControls.appendChild(createDeviceBtn('mobile', '375', 'Mobile (375px)'));
    tabStrip.appendChild(deviceControls);
    browserBar.appendChild(tabStrip);

    // 2. Navigation & Address Bar
    const navBar = document.createElement('div');
    navBar.className = 'flex items-center gap-2 px-3 py-1.5 bg-[#1e1e2e]';

    const navBtns = document.createElement('div');
    navBtns.className = 'flex items-center gap-1 text-gray-400';
    navBtns.innerHTML = `
      <button class="p-1 hover:text-white rounded hover:bg-gray-800" title="Назад">←</button>
      <button class="p-1 hover:text-white rounded hover:bg-gray-800" title="Вперед">→</button>
    `;
    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'p-1 hover:text-white rounded hover:bg-gray-800 text-accent transition';
    reloadBtn.title = 'Обновить страницу';
    reloadBtn.textContent = '🔄';
    reloadBtn.onclick = () => refreshPreview();
    navBtns.appendChild(reloadBtn);
    navBar.appendChild(navBtns);

    // Address Bar Input Box
    const addressBox = document.createElement('div');
    addressBox.className = 'flex-1 flex items-center gap-2 px-2.5 py-1 bg-black/40 border border-gray-700 rounded-lg text-gray-300 font-mono text-[11px] truncate shadow-inner';
    const serverActive = Boolean(serverProcess);
    const hostUrl = serverActive
      ? `http://${window.location.hostname || 'localhost'}:${serverPort}/${file ? file.name : ''}`
      : `preview://local/${file ? file.name : 'index.html'}`;

    addressBox.innerHTML = `
      <span class="text-xs text-teal-400">${serverActive ? '🔒' : '📄'}</span>
      <span class="truncate">${hostUrl}</span>
      <span class="ml-auto text-[10px] px-1 rounded ${serverActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-400'} font-sans">
        ${serverActive ? '200 OK (Live)' : 'Static'}
      </span>
    `;
    navBar.appendChild(addressBox);

    // Server controls
    const serverBtn = document.createElement('button');
    serverBtn.className = 'px-2 py-1 rounded text-[11px] transition font-medium flex items-center gap-1 ' +
      (serverActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-800 hover:bg-gray-700 text-gray-300');
    serverBtn.innerHTML = serverActive ? '🟢 :8085' : '▶ Сервер :8085';
    serverBtn.onclick = async () => {
      if (serverActive) {
        await stopServer();
      } else {
        await startServer();
      }
      renderPreviewUI(container);
    };
    navBar.appendChild(serverBtn);

    if (serverActive) {
      const openExternalBtn = document.createElement('button');
      openExternalBtn.className = 'p-1 hover:bg-gray-800 rounded text-gray-300 hover:text-white transition';
      openExternalBtn.title = 'Открыть в отдельной вкладке браузера';
      openExternalBtn.textContent = '🔗';
      openExternalBtn.onclick = () => {
        window.open(hostUrl, '_blank');
      };
      navBar.appendChild(openExternalBtn);
    }

    browserBar.appendChild(navBar);
    wrapper.appendChild(browserBar);

    // ========================================================================
    // Main Content Area
    // ========================================================================
    if (hasWebFile) {
      const frameContainer = document.createElement('div');
      frameContainer.className = 'flex-1 overflow-auto flex items-center justify-center p-2 bg-[#12121a]';

      const iframe = document.createElement('iframe');
      iframe.id = 'web-devkit-frame';
      iframe.className = 'h-full bg-white transition-all duration-200 rounded shadow-2xl border border-gray-700';
      iframe.sandbox = 'allow-scripts allow-forms allow-same-origin allow-modals';

      if (deviceMode === 'desktop') iframe.style.width = '1280px';
      else if (deviceMode === 'tablet') iframe.style.width = '768px';
      else if (deviceMode === 'mobile') iframe.style.width = '375px';
      else iframe.style.width = '100%';

      frameContainer.appendChild(iframe);
      wrapper.appendChild(frameContainer);
      container.appendChild(wrapper);

      loadIframeContent(iframe);
    } else {
      // Launchpad view
      const launchpad = document.createElement('div');
      launchpad.className = 'flex-1 flex flex-col items-center justify-center p-6 text-center overflow-auto bg-[#12121a]';
      launchpad.innerHTML = `
        <div class="max-w-md p-6 rounded-2xl bg-[#1e1e2e] border border-gray-700 shadow-2xl text-left">
          <div class="flex items-center space-x-3 mb-4">
            <span class="text-3xl">🌐</span>
            <div>
              <h3 class="text-base font-bold text-gray-100">Web DevKit v1.2</h3>
              <p class="text-xs text-gray-400">Живой предпросмотр, имитация Chrome и веб-сервер</p>
            </div>
          </div>
          <div class="p-3 mb-4 rounded-xl bg-black/30 border border-gray-700 text-xs text-gray-300">
            <span class="text-gray-400">Активный файл:</span> 
            <span class="font-mono text-accent font-semibold">${file ? file.name : 'файл не открыт'}</span>
            <div class="mt-1 text-[11px] text-gray-500">
              ${file ? 'Файл не является веб-страницей. Вы можете быстро создать шаблон:' : 'Откройте или создайте HTML/PHP файл.'}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2.5 mb-4">
            <button id="devkit-create-html" class="p-3 rounded-xl bg-accent/15 border border-accent/30 hover:bg-accent/25 text-accent font-semibold text-xs flex flex-col items-center text-center transition cursor-pointer">
              <span class="text-lg mb-1">📄</span>
              <span>Создать index.html</span>
              <span class="text-[10px] text-gray-400 font-normal mt-0.5">HTML5 + Tailwind CDN</span>
            </button>
            <button id="devkit-create-php" class="p-3 rounded-xl bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25 text-purple-300 font-semibold text-xs flex flex-col items-center text-center transition cursor-pointer">
              <span class="text-lg mb-1">🐘</span>
              <span>Создать index.php</span>
              <span class="text-[10px] text-gray-400 font-normal mt-0.5">PHP скрипт с сервером</span>
            </button>
          </div>
        </div>
      `;
      wrapper.appendChild(launchpad);
      container.appendChild(wrapper);

      const htmlBtn = wrapper.querySelector('#devkit-create-html');
      if (htmlBtn) {
        htmlBtn.onclick = async () => {
          const starterHtml = '<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Мой сайт — Web DevKit</title>\n  <script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body class="bg-gray-900 text-gray-100 min-h-screen flex items-center justify-center p-6">\n  <div class="max-w-md w-full p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 text-center">\n    <div class="text-5xl mb-4">🚀</div>\n    <h1 class="text-2xl font-bold text-white mb-2">Web DevKit Работает!</h1>\n    <p class="text-gray-400 text-sm mb-6">Живой предпросмотр HTML & CSS прямо внутри Config Studio.</p>\n    <button class="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-gray-900 font-bold rounded-xl shadow-lg transition" onclick="alert(\'Кнопка нажата!\')">\n      Нажми меня!\n    </button>\n  </div>\n</body>\n</html>';
          await window.ConfigStudio.createFile('index.html', starterHtml);
          window.ConfigStudio.showNotification('Файл index.html создан!', 'success');
        };
      }

      const phpBtn = wrapper.querySelector('#devkit-create-php');
      if (phpBtn) {
        phpBtn.onclick = async () => {
          const starterPhp = '<?php\nheader("Content-Type: text/html; charset=utf-8");\n$time = date("H:i:s d.m.Y");\n$phpVersion = phpversion();\n?>\n<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <title>PHP Сервер — Web DevKit</title>\n  <script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body class="bg-slate-900 text-white min-h-screen flex items-center justify-center p-6">\n  <div class="max-w-md p-6 bg-slate-800 rounded-2xl border border-slate-700 shadow-xl text-center">\n    <div class="text-4xl mb-3">🐘</div>\n    <h2 class="text-xl font-bold mb-2">PHP Выполняется на сервере</h2>\n    <p class="text-sm text-slate-300 mb-4">Время сервера: <span class="font-mono text-emerald-400"><?= $time ?></span></p>\n    <p class="text-xs text-slate-400">Версия PHP: <?= $phpVersion ?></p>\n  </div>\n</body>\n</html>';
          await window.ConfigStudio.createFile('index.php', starterPhp);
          window.ConfigStudio.showNotification('Файл index.php создан! Запустите сервер кнопкой выше для выполнения PHP.', 'info');
        };
      }
    }
  }

  function updateFrameSize() {
    const iframe = document.getElementById('web-devkit-frame');
    if (!iframe) return;
    if (deviceMode === 'desktop') iframe.style.width = '1280px';
    else if (deviceMode === 'tablet') iframe.style.width = '768px';
    else if (deviceMode === 'mobile') iframe.style.width = '375px';
    else iframe.style.width = '100%';
  }

  function loadIframeContent(iframe) {
    const file = window.ConfigStudio.getActiveFile();
    if (!file) return;

    const lower = file.path.toLowerCase();
    const isPhp = lower.endsWith('.php') || lower.endsWith('.phtml');

    if (serverProcess) {
      const filename = file.name;
      iframe.src = 'http://' + (window.location.hostname || 'localhost') + ':' + serverPort + '/' + filename;
    } else {
      if (isPhp) {
        iframe.srcdoc = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script></head>
          <body class="bg-gray-900 text-white flex flex-col items-center justify-center h-screen p-6 text-center font-sans">
            <div class="max-w-sm p-6 bg-gray-800 rounded-2xl border border-gray-700 shadow-xl">
              <div class="text-4xl mb-3">🐘</div>
              <h3 class="text-base font-bold mb-2">Требуется запуск сервера</h3>
              <p class="text-xs text-gray-400 mb-4">Для выполнения PHP скриптов запустите веб-сервер кнопкой в панели сверху.</p>
              <div class="text-[11px] font-mono text-emerald-400 bg-gray-900 p-2 rounded">php -S 0.0.0.0:8085</div>
            </div>
          </body>
          </html>
        `;
      } else {
        iframe.srcdoc = file.content;
      }
    }
  }

  function refreshPreview() {
    const iframe = document.getElementById('web-devkit-frame');
    if (iframe) loadIframeContent(iframe);
  }

  async function startServer() {
    try {
      window.ConfigStudio.showNotification('Запуск PHP/Web сервера на порту 8085...', 'info');
      const proc = await window.ConfigStudio.startProcess({
        pluginId: pluginId,
        command: 'php',
        args: ['-S', '0.0.0.0:' + serverPort],
        port: serverPort
      });
      serverProcess = proc;
      window.ConfigStudio.showNotification('Сервер PHP успешно запущен на порту ' + serverPort, 'success');
      refreshPreview();
    } catch (err) {
      try {
        const proc = await window.ConfigStudio.startProcess({
          pluginId: pluginId,
          command: 'python',
          args: ['-m', 'http.server', String(serverPort)],
          port: serverPort
        });
        serverProcess = proc;
        window.ConfigStudio.showNotification('Сервер Python запущен на порту ' + serverPort, 'success');
        refreshPreview();
      } catch (err2) {
        window.ConfigStudio.showNotification('Не удалось запустить сервер: ' + (err.message || err), 'error');
      }
    }
  }

  async function stopServer() {
    if (serverProcess && serverProcess.id) {
      await window.ConfigStudio.stopProcess(serverProcess.id);
      serverProcess = null;
      window.ConfigStudio.showNotification('Сервер остановлен', 'info');
      refreshPreview();
    }
  }

  window.ConfigStudio.onFileSave((file) => {
    if (previewActive) refreshPreview();
  });

  window.ConfigStudio.onFileOpen((file) => {
    if (previewActive) {
      const container = document.getElementById('web-devkit-preview-panel');
      if (container) renderPreviewUI(container);
    }
  });

  console.log('[WebDevKit v1.2.0] Plugin loaded with Chrome Browser Preview and AST Parsers.');
})();
