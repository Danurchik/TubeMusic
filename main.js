const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { Client } = require('@xhayper/discord-rpc');

app.name = 'TubeMusic';
app.setAppUserModelId('com.tm.desktop');

const CLIENT_ID = '1551213029717442611';
const rpc = new Client({ clientId: CLIENT_ID });

let mainWindow;
let currentDiscordState = { title: '', isPlaying: false };
let rpcUpdateTimeout = null;

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

    setInterval(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-sync-request', currentDiscordState);
      }
    }, 10000);
  });

  mainWindow.on('close', (event) => {
    event.preventDefault();
    if (rpc.user) rpc.user.clearActivity().catch(() => {});
    mainWindow.destroy();
    app.quit();
    process.exit(0);
  });
}

ipcMain.on('track-update', (event, track) => {
  event.reply('discord-ack', `Данные трека "${track.title}" успешно получены.`);
  currentDiscordState = { title: track.title, isPlaying: track.isPlaying };
  
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
  };

  rpcUpdateTimeout = setTimeout(() => {
    rpc.user.setActivity(activity).catch(console.error);
  }, 1500); 
});

function connectDiscord() {
  rpc.login().catch(() => {
    setTimeout(connectDiscord, 5000);
  });
}

app.whenReady().then(() => {
  createWindow();
  connectDiscord();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});