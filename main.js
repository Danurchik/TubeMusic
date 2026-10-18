const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('@xhayper/discord-rpc');

app.name = 'TubeMusic';
app.setAppUserModelId('com.tm.desktop');

const CLIENT_ID = '1551213029717442611';
const rpc = new Client({ clientId: CLIENT_ID });

let mainWindow;
let currentTrack = null;
let rpcUpdateTimeout = null;
let rpcRetryTimeout = null;
let syncInterval = null;
let isQuitting = false;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaultSettings = { widgetEnabled: true, widgetPosition: 'bottom-right', widgetDuration: 4, widgetTheme: 'glass', widgetDisplayId: null, miniPlayerEnabled: false };
let settings = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const loaded = { ...defaultSettings, ...saved };
    if (!['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].includes(loaded.widgetPosition)) loaded.widgetPosition = defaultSettings.widgetPosition;
    if (![4, 6, 8].includes(loaded.widgetDuration)) loaded.widgetDuration = defaultSettings.widgetDuration;
    if (!['glass', 'dark', 'light'].includes(loaded.widgetTheme)) loaded.widgetTheme = defaultSettings.widgetTheme;
    if (typeof loaded.widgetEnabled !== 'boolean') loaded.widgetEnabled = defaultSettings.widgetEnabled;
    if (typeof loaded.miniPlayerEnabled !== 'boolean') loaded.miniPlayerEnabled = defaultSettings.miniPlayerEnabled;
    return loaded;
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Не удалось сохранить настройки:', error);
  }
}

const prevIcon = nativeImage.createFromPath(path.join(__dirname, 'prev.png'));
const playIcon = nativeImage.createFromPath(path.join(__dirname, 'play.png'));
const pauseIcon = nativeImage.createFromPath(path.join(__dirname, 'pause.png'));
const nextIcon = nativeImage.createFromPath(path.join(__dirname, 'next.png'));
const likeFilledIcon = nativeImage.createFromPath(path.join(__dirname, 'like_filled.png'));
const likeOutlineIcon = nativeImage.createFromPath(path.join(__dirname, 'like_outline.png'));

function updateThumbar(isPlaying, isLiked) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const currentLikeIcon = isLiked ? likeFilledIcon : likeOutlineIcon;

  mainWindow.setThumbarButtons([
    {
      tooltip: isLiked ? 'Убрать лайк' : 'Поставить лайк',
      icon: currentLikeIcon.isEmpty() ? nativeImage.createEmpty() : currentLikeIcon,
      click() { mainWindow.webContents.send('media-control', 'like'); }
    },
    {
      tooltip: 'Предыдущий трек',
      icon: prevIcon.isEmpty() ? nativeImage.createEmpty() : prevIcon,
      click() { mainWindow.webContents.send('media-control', 'previous'); }
    },
    {
      tooltip: isPlaying ? 'Пауза' : 'Играть',
      icon: isPlaying ? 
        (pauseIcon.isEmpty() ? nativeImage.createEmpty() : pauseIcon) : 
        (playIcon.isEmpty() ? nativeImage.createEmpty() : playIcon),
      click() { mainWindow.webContents.send('media-control', 'play-pause'); }
    },
    {
      tooltip: 'Следующий трек',
      icon: nextIcon.isEmpty() ? nativeImage.createEmpty() : nextIcon,
      click() { mainWindow.webContents.send('media-control', 'next'); }
    }
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'TubeMusic',
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'TubeMusic_icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL('https://music.youtube.com');

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      ::-webkit-scrollbar { width: 0px; background: transparent; }
      ytmusic-pivot-bar-renderer { display: none !important; }
    `);

    clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-sync-request', currentTrack && {
          title: currentTrack.title,
          isPlaying: currentTrack.isPlaying
        });
      }
    }, 10000);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) console.warn(`Не удалось загрузить ${validatedURL}: ${errorDescription}`);
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    clearInterval(syncInterval);
    clearTimeout(rpcUpdateTimeout);
    clearTimeout(rpcRetryTimeout);
    if (rpc.user) rpc.user.clearActivity().catch(() => {});
    app.quit();
  });
}

ipcMain.on('track-update', (event, track) => {
  if (!track || typeof track.title !== 'string' || typeof track.isPlaying !== 'boolean') return;

  const previousTrack = currentTrack;
  if (settings.widgetEnabled && track.isPlaying && track.title !== previousTrack?.title && widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('show-widget', {
      title: track.title,
      artist: track.artist,
      cover: track.artwork || '',
      position: settings.widgetPosition,
      theme: settings.widgetTheme,
      duration: settings.widgetDuration
    });
  }

  currentTrack = track;
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('mini-player-track', {
      title: track.title,
      artist: track.artist,
      cover: track.artwork || '',
      isPlaying: track.isPlaying,
      isLiked: track.isLiked
    });
  }
  
  updateThumbar(track.isPlaying, track.isLiked);

  if (!rpc.user) return;
  if (rpcUpdateTimeout) clearTimeout(rpcUpdateTimeout);

  if (!track.isPlaying) {
    rpc.user.clearActivity().catch(() => {});
    return;
  }

  const now = Date.now();
  const startTimestamp = now - Math.floor(track.currentTime * 1000);
  const endTimestamp = startTimestamp + Math.floor(track.duration * 1000);

  const activity = {
    type: 2, 
    details: track.title,
    state: track.artist,
    largeImageKey: track.artwork || 'ytm_logo',
    largeImageText: track.album || track.title,
    startTimestamp: startTimestamp,
    endTimestamp: endTimestamp,
    buttons: track.url ? [{ label: 'Открыть в YouTube Music', url: track.url }] : undefined,
  };

  rpcUpdateTimeout = setTimeout(() => {
    if (rpc.user && currentTrack?.title === track.title && currentTrack.isPlaying) {
      rpc.user.setActivity(activity).catch(console.error);
    }
  }, 1500); 
});

function connectDiscord() {
  if (isQuitting) return;
  rpc.login().catch(() => {
    clearTimeout(rpcRetryTimeout);
    rpcRetryTimeout = setTimeout(connectDiscord, 5000);
  });
}

rpc.on('disconnected', () => {
  if (isQuitting) return;
  clearTimeout(rpcRetryTimeout);
  rpcRetryTimeout = setTimeout(connectDiscord, 5000);
});

rpc.on('ready', () => {
  clearTimeout(rpcRetryTimeout);
  if (currentTrack && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('discord-sync-request', { title: '', isPlaying: false });
  }
});

let widgetWindow;
let miniPlayerWindow;
let tray = null;

ipcMain.on('mini-player-control', (_event, action) => {
  if (!['play-pause', 'previous', 'next', 'like'].includes(action)) return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media-control', action);
});

function getWidgetDisplay() {
  const displays = screen.getAllDisplays();
  return displays.find(display => display.id === settings.widgetDisplayId) || screen.getPrimaryDisplay();
}

function getWidgetBounds(wWidth = 380, wHeight = 120) {
  const { x: areaX, y: areaY, width, height } = getWidgetDisplay().workArea;
  const padding = 20;
  let x = areaX;
  let y = areaY;
  switch (settings.widgetPosition) {
    case 'top-right': x += width - wWidth; y += padding; break;
    case 'bottom-right': x += width - wWidth; y += height - wHeight; break;
    case 'top-left': y += padding; break;
    case 'bottom-left': y += height - wHeight; break;
    case 'top-center': x += Math.floor((width - wWidth) / 2); y += padding; break;
    case 'bottom-center': x += Math.floor((width - wWidth) / 2); y += height - wHeight; break;
  }
  return { x, y, width: wWidth, height: wHeight };
}

function createWidgetWindow() {
  widgetWindow = new BrowserWindow({
    ...getWidgetBounds(),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'widget-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  widgetWindow.setIgnoreMouseEvents(true);
  widgetWindow.loadFile('widget.html');
  widgetWindow.on('closed', () => { widgetWindow = null; });
}

function updateWidgetPosition(newPos) {
  settings.widgetPosition = newPos;
  saveSettings();
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setBounds(getWidgetBounds());
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('widget-position', newPos);
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.setBounds(getWidgetBounds(360, 104));
}

function setMiniPlayerEnabled(enabled) {
  settings.miniPlayerEnabled = enabled;
  saveSettings();
  if (enabled) {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) createMiniPlayerWindow();
    else miniPlayerWindow.showInactive();
  } else if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.close();
  }
}

function createMiniPlayerWindow() {
  miniPlayerWindow = new BrowserWindow({
    ...getWidgetBounds(360, 104),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'widget-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  miniPlayerWindow.loadFile('mini-player.html');
  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null;
    if (!isQuitting && settings.miniPlayerEnabled) {
      settings.miniPlayerEnabled = false;
      saveSettings();
    }
  });
  if (currentTrack) {
    miniPlayerWindow.webContents.once('did-finish-load', () => {
      miniPlayerWindow?.webContents.send('mini-player-track', {
        title: currentTrack.title,
        artist: currentTrack.artist,
        cover: currentTrack.artwork || '',
        isPlaying: currentTrack.isPlaying,
        isLiked: currentTrack.isLiked
      });
    });
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'TubeMusic_icon.png'));

  const updateContextMenu = () => {
    const displays = screen.getAllDisplays();
    const currentDisplay = getWidgetDisplay();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Показывать виджет треков',
        type: 'checkbox',
        checked: settings.widgetEnabled,
        click: (item) => {
          settings.widgetEnabled = item.checked;
          saveSettings();
          if (!item.checked && widgetWindow && !widgetWindow.isDestroyed()) {
            widgetWindow.webContents.send('hide-widget');
          }
        }
      },
      {
        label: 'Компактный мини-плеер',
        type: 'checkbox',
        checked: settings.miniPlayerEnabled,
        click: (item) => setMiniPlayerEnabled(item.checked)
      },
      {
        label: 'Оформление виджета',
        submenu: [
          { label: 'Стекло', type: 'radio', checked: settings.widgetTheme === 'glass', click: () => { settings.widgetTheme = 'glass'; saveSettings(); } },
          { label: 'Тёмный', type: 'radio', checked: settings.widgetTheme === 'dark', click: () => { settings.widgetTheme = 'dark'; saveSettings(); } },
          { label: 'Светлый', type: 'radio', checked: settings.widgetTheme === 'light', click: () => { settings.widgetTheme = 'light'; saveSettings(); } }
        ]
      },
      {
        label: 'Время показа',
        submenu: [
          { label: '4 секунды', type: 'radio', checked: settings.widgetDuration === 4, click: () => { settings.widgetDuration = 4; saveSettings(); } },
          { label: '6 секунд', type: 'radio', checked: settings.widgetDuration === 6, click: () => { settings.widgetDuration = 6; saveSettings(); } },
          { label: '8 секунд', type: 'radio', checked: settings.widgetDuration === 8, click: () => { settings.widgetDuration = 8; saveSettings(); } }
        ]
      },
      { type: 'separator' },
      { label: 'Сверху слева', type: 'radio', checked: settings.widgetPosition === 'top-left', click: () => updateWidgetPosition('top-left') },
      { label: 'Сверху по центру', type: 'radio', checked: settings.widgetPosition === 'top-center', click: () => updateWidgetPosition('top-center') },
      { label: 'Сверху справа', type: 'radio', checked: settings.widgetPosition === 'top-right', click: () => updateWidgetPosition('top-right') },
      { label: 'Снизу слева', type: 'radio', checked: settings.widgetPosition === 'bottom-left', click: () => updateWidgetPosition('bottom-left') },
      { label: 'Снизу по центру', type: 'radio', checked: settings.widgetPosition === 'bottom-center', click: () => updateWidgetPosition('bottom-center') },
      { label: 'Снизу справа', type: 'radio', checked: settings.widgetPosition === 'bottom-right', click: () => updateWidgetPosition('bottom-right') },
      {
        label: 'Монитор виджета',
        submenu: displays.map((display, index) => ({
          label: display.label || `Монитор ${index + 1}`,
          type: 'radio',
          checked: display.id === currentDisplay.id,
          click: () => {
            settings.widgetDisplayId = display.id;
            saveSettings();
            if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setBounds(getWidgetBounds());
            if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.setBounds(getWidgetBounds(360, 104));
          }
        }))
      },
      { type: 'separator' },
      { label: 'Выход', click: () => { app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateContextMenu();
  tray.setToolTip('TubeMusic');

  // Обновляем меню при каждом клике, чтобы перерисовать галочки (radio buttons)
  tray.on('right-click', updateContextMenu);
}

app.whenReady().then(() => {
  createWindow();
  connectDiscord();
  createWidgetWindow();
  createTray(); // Запускаем трей
  if (settings.miniPlayerEnabled) createMiniPlayerWindow();

  screen.on('display-removed', () => {
    if (!screen.getAllDisplays().some(display => display.id === settings.widgetDisplayId)) {
      settings.widgetDisplayId = null;
      saveSettings();
      if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setBounds(getWidgetBounds());
      if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.setBounds(getWidgetBounds(360, 104));
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(syncInterval);
  clearTimeout(rpcUpdateTimeout);
  clearTimeout(rpcRetryTimeout);
});
