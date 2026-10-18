/**
 * Web DevKit Plugin for Config Studio
 * Provides Live HTML/PHP Preview, device frame simulation, Monaco autocompletions and host server integration.
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
    return lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.php') || lower.endsWith('.phtml');
  };

  // Register Monaco Autocomplete Providers for HTML & PHP
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
          { label: 'a', kind: kind, insertText: '<a href="${1:#}" class="text-blue-400 hover:underline ${2}">${0:Ссылка}</a>', insertTextRules: 4, documentation: 'HTML <a> ссылка' },
          { label: 'script', kind: kind, insertText: '<script>\n  ${0}\n</script>', insertTextRules: 4, documentation: 'HTML <script> тег' },
          { label: 'style', kind: kind, insertText: '<style>\n  ${0}\n</style>', insertTextRules: 4, documentation: 'HTML <style> тег' },
          { label: 'img', kind: kind, insertText: '<img src="${1}" alt="${2}" class="${3}" />', insertTextRules: 4, documentation: 'HTML <img>' }
        ];
        return { suggestions: suggestions };
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
          { label: 'print_r', kind: funcKind, insertText: 'print_r(${1:\\$var});', insertTextRules: 4, documentation: 'Печать структуры массива' },
          { label: 'json_encode', kind: funcKind, insertText: 'json_encode(${1:\\$data}, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);', insertTextRules: 4, documentation: 'Преобразование в JSON' },
          { label: 'json_decode', kind: funcKind, insertText: 'json_decode(${1:\\$json}, true);', insertTextRules: 4, documentation: 'Декодирование JSON' },
          { label: 'foreach', kind: kind, insertText: 'foreach (${1:\\$items} as ${2:\\$item}) {\n    ${0}\n}', insertTextRules: 4, documentation: 'Цикл foreach' },
          { label: 'function', kind: kind, insertText: 'function ${1:myFunction}(${2}): ${3:void} {\n    ${0}\n}', insertTextRules: 4, documentation: 'Объявление функции' },
          { label: 'trycatch', kind: kind, insertText: 'try {\n    ${1}\n} catch (\\Throwable \\$e) {\n    echo \\$e->getMessage();\n}', insertTextRules: 4, documentation: 'Перехват исключений try/catch' },
          { label: 'header', kind: funcKind, insertText: "header('Content-Type: application/json; charset=utf-8');", insertTextRules: 4, documentation: 'Установка HTTP заголовка' },
          { label: 'isset', kind: funcKind, insertText: 'isset(${1:\\$var})', insertTextRules: 4, documentation: 'Проверка переменной isset()' },
          { label: 'empty', kind: funcKind, insertText: 'empty(${1:\\$var})', insertTextRules: 4, documentation: 'Проверка на пустоту empty()' }
        ];
        return { suggestions: suggestions };
      }
    };
    window.ConfigStudio.registerCompletionProvider('php', phpProvider);
  } catch (err) {
    console.warn('[WebDevKit] Error setting up completions:', err);
  }

  // Register Header Toolbar Button (Always visible)
  window.ConfigStudio.registerToolbarButton({
    id: 'web-devkit-preview-btn',
    pluginId: pluginId,
    label: 'Web DevKit',
    title: 'Web DevKit — Живой предпросмотр HTML/PHP и веб-сервер',
    icon: 'globe',
    visible: () => true,
    onClick: () => {
      togglePreview();
    }
  });

  function togglePreview() {
    previewActive = !previewActive;
    window.ConfigStudio.toggleSplitPanel({
      id: 'web-devkit-preview-panel',
      pluginId: pluginId,
      title: 'Web DevKit — Живой предпросмотр & Сервер',
      open: previewActive,
      render: (container) => renderPreviewUI(container)
    });
  }

  function renderPreviewUI(container) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'web-devkit-container flex flex-col h-full w-full bg-base-surface text-xs select-none';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'web-devkit-toolbar flex flex-wrap items-center justify-between px-3 py-2 border-b border-base-border bg-base gap-2';

    const leftControls = document.createElement('div');
    leftControls.className = 'flex items-center gap-1.5';

    // Device switcher buttons
    const createDeviceBtn = (mode, label, title) => {
      const btn = document.createElement('button');
      btn.className = 'px-2 py-1 rounded text-xs transition font-medium ' + 
        (deviceMode === mode ? 'bg-accent text-gray-900 font-semibold' : 'hover:bg-base-surface-hover text-gray-400');
      btn.textContent = label;
      btn.title = title;
      btn.onclick = () => {
        deviceMode = mode;
        updateFrameSize();
        renderPreviewUI(container);
      };
      return btn;
    };

    leftControls.appendChild(createDeviceBtn('responsive', 'Full', 'Полная ширина'));
    leftControls.appendChild(createDeviceBtn('desktop', '1280px', 'Экран ПК (1280px)'));
    leftControls.appendChild(createDeviceBtn('tablet', '768px', 'Планшет (768px)'));
    leftControls.appendChild(createDeviceBtn('mobile', '375px', 'Смартфон (375px)'));

    // Server Controls
    const rightControls = document.createElement('div');
    rightControls.className = 'flex items-center gap-1.5';

    const serverBtn = document.createElement('button');
    serverBtn.className = 'px-2.5 py-1 rounded text-xs transition font-medium flex items-center gap-1 ' +
      (serverProcess ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-base-surface-hover hover:bg-base-border text-gray-300');
    serverBtn.innerHTML = serverProcess ? '🟢 Сервер :8085' : '▶ Запустить сервер :8085';
    serverBtn.onclick = async () => {
      if (serverProcess) {
        await stopServer();
      } else {
        await startServer();
      }
      renderPreviewUI(container);
    };
    rightControls.appendChild(serverBtn);

    if (serverProcess) {
      const openTabBtn = document.createElement('button');
      openTabBtn.className = 'p-1 hover:bg-base-surface-hover rounded text-gray-300 hover:text-white transition';
      openTabBtn.title = 'Открыть в новой вкладке браузера';
      openTabBtn.innerHTML = '🔗';
      openTabBtn.onclick = () => {
        const file = window.ConfigStudio.getActiveFile();
        const url = 'http://' + window.location.hostname + ':' + serverPort + '/' + (file ? file.name : '');
        window.open(url, '_blank');
      };
      rightControls.appendChild(openTabBtn);
    }

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'p-1 hover:bg-base-surface-hover rounded text-gray-300 hover:text-white transition';
    refreshBtn.title = 'Обновить предпросмотр';
    refreshBtn.innerHTML = '🔄';
    refreshBtn.onclick = () => refreshPreview();
    rightControls.appendChild(refreshBtn);

    toolbar.appendChild(leftControls);
    toolbar.appendChild(rightControls);
    wrapper.appendChild(toolbar);

    // Main Content Area
    const file = window.ConfigStudio.getActiveFile();
    const hasWebFile = file && isWebFile(file.path);

    if (hasWebFile) {
      // Frame area
      const frameContainer = document.createElement('div');
      frameContainer.className = 'flex-1 overflow-auto flex items-center justify-center p-2 bg-black/40';

      const iframe = document.createElement('iframe');
      iframe.id = 'web-devkit-frame';
      iframe.className = 'h-full bg-white transition-all duration-200 rounded shadow-lg border border-base-border';
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
      // Welcome / Launchpad view when editing non-web file
      const launchpad = document.createElement('div');
      launchpad.className = 'flex-1 flex flex-col items-center justify-center p-6 text-center overflow-auto';
      
      launchpad.innerHTML = `
        <div class="max-w-md p-6 rounded-2xl bg-base border border-base-border shadow-xl text-left">
          <div class="flex items-center space-x-3 mb-4">
            <span class="text-3xl">🌐</span>
            <div>
              <h3 class="text-base font-bold text-gray-100">Web DevKit готов к работе</h3>
              <p class="text-xs text-gray-400">Предпросмотр HTML/PHP, сервер и автодополнение</p>
            </div>
          </div>
          
          <div class="p-3 mb-4 rounded-xl bg-base-surface border border-base-border text-xs text-gray-300">
            <span class="text-gray-400">Текущий файл:</span> 
            <span class="font-mono text-accent font-semibold">${file ? file.name : 'файл не открыт'}</span>
            <div class="mt-1 text-[11px] text-gray-500">
              ${file ? 'Файл не является веб-страницей. Вы можете быстро создать веб-шаблон ниже:' : 'Откройте или создайте HTML/PHP файл для предпросмотра.'}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2.5 mb-5">
            <button id="devkit-create-html" class="p-3 rounded-xl bg-accent/15 border border-accent/30 hover:bg-accent/25 text-accent font-semibold text-xs flex flex-col items-center text-center transition cursor-pointer">
              <span class="text-lg mb-1">📄</span>
              <span>Создать index.html</span>
              <span class="text-[10px] text-gray-400 font-normal mt-0.5">Шаблон HTML5 + Tailwind</span>
            </button>
            <button id="devkit-create-php" class="p-3 rounded-xl bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25 text-purple-300 font-semibold text-xs flex flex-col items-center text-center transition cursor-pointer">
              <span class="text-lg mb-1">🐘</span>
              <span>Создать index.php</span>
              <span class="text-[10px] text-gray-400 font-normal mt-0.5">PHP скрипт с сервером</span>
            </button>
          </div>

          <div class="space-y-1.5 text-[11px] text-gray-400 border-t border-base-border pt-3">
            <div class="flex items-center space-x-2">
              <span class="text-emerald-400">✓</span>
              <span>Monaco автодополнение тегов HTML5 и PHP функций</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-emerald-400">✓</span>
              <span>Встроенный веб-сервер на порту 8085</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-emerald-400">✓</span>
              <span>Адаптивные экраны: Full / Desktop / Tablet / Mobile</span>
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-emerald-400">✓</span>
              <span>Автообновление предпросмотра при сохранении (Ctrl+S)</span>
            </div>
          </div>
        </div>
      `;

      wrapper.appendChild(launchpad);
      container.appendChild(wrapper);

      // Wire quick create buttons
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
      // Load through live web server
      const filename = file.name;
      iframe.src = 'http://' + window.location.hostname + ':' + serverPort + '/' + filename;
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
              <p class="text-xs text-gray-400 mb-4">Для выполнения PHP скриптов запустите локальный веб-сервер кнопкой в верхней панели.</p>
              <div class="text-[11px] font-mono text-emerald-400 bg-gray-900 p-2 rounded">php -S 0.0.0.0:8085</div>
            </div>
          </body>
          </html>
        `;
      } else {
        // Direct HTML preview
        iframe.srcdoc = file.content;
      }
    }
  }

  function refreshPreview() {
    const iframe = document.getElementById('web-devkit-frame');
    if (iframe) {
      loadIframeContent(iframe);
    }
  }

  async function startServer() {
    try {
      window.ConfigStudio.showNotification('Запуск PHP/Web сервера на порту 8085...', 'info');
      // Attempt php -S first, with fallback to python3 -m http.server
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
      console.warn('php server failed, trying python:', err);
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

  // Auto-reload preview on file save
  window.ConfigStudio.onFileSave((file) => {
    if (previewActive) {
      refreshPreview();
    }
  });

  // Reload on active file switch
  window.ConfigStudio.onFileOpen((file) => {
    if (previewActive) {
      const container = document.getElementById('web-devkit-preview-panel');
      if (container) {
        renderPreviewUI(container);
      }
    }
  });

  console.log('[WebDevKit] Plugin initialized successfully.');
})();
