const { ipcRenderer } = require('electron');

let lastExpectedEndTime = 0;

function parseTime(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function getRealState() {
  const media = navigator.mediaSession?.metadata;
  const video = document.querySelector('video');
  const timeInfo = document.querySelector('.time-info.ytmusic-player-bar')?.innerText || '';

  if (!media || !video || !timeInfo) return null;

  const [currentStr, durationStr] = timeInfo.split(' / ');
  const currentTime = parseTime(currentStr);
  const duration = parseTime(durationStr);

  if (duration === 0) return null;

  let artworkUrl = '';
  if (media.artwork && media.artwork.length > 0) {
    artworkUrl = media.artwork[media.artwork.length - 1].src.replace(/w\d+-h\d+/, 'w512-h512');
  }

  const likeContainer = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer .like');
  let isLiked = false;
  if (likeContainer) {
    const innerBtn = likeContainer.querySelector('button');
    isLiked = (likeContainer.getAttribute('aria-pressed') === 'true') || 
              (innerBtn && innerBtn.getAttribute('aria-pressed') === 'true');
  }

  return {
    title: media.title || 'Неизвестный трек',
    artist: media.artist || 'Неизвестный исполнитель',
    album: media.album || '',
    artwork: artworkUrl,
    currentTime,
    duration,
    isPlaying: !video.paused && video.playbackRate > 0,
    isLiked
  };
}

let lastSentState = null;

function checkAndSend() {
  const realState = getRealState();
  if (!realState) return;

  const expectedEndTime = Date.now() + Math.floor((realState.duration - realState.currentTime) * 1000);
  
  const isStateChanged = !lastSentState || realState.isPlaying !== lastSentState.isPlaying;
  const isTitleChanged = !lastSentState || realState.title !== lastSentState.title;
  const isLikeChanged = !lastSentState || realState.isLiked !== lastSentState.isLiked;
  const isSeeked = realState.isPlaying && Math.abs(expectedEndTime - lastExpectedEndTime) > 3000;

  if (isStateChanged || isTitleChanged || isLikeChanged || isSeeked) {
    ipcRenderer.send('track-update', realState);
    lastSentState = realState;
    if (realState.isPlaying) lastExpectedEndTime = expectedEndTime;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setInterval(checkAndSend, 1000);
});

ipcRenderer.on('discord-sync-request', (event, discordMemory) => {
  const realState = getRealState();
  if (!realState) return;

  const isDiscordWrong = 
    discordMemory.title !== realState.title || 
    discordMemory.isPlaying !== realState.isPlaying;

  if (isDiscordWrong) {
    ipcRenderer.send('track-update', realState);
    lastSentState = realState;
  }
});

ipcRenderer.on('discord-ack', (event, message) => {
});

ipcRenderer.on('media-control', (event, action) => {
  if (action === 'play-pause') {
    document.querySelector('#play-pause-button')?.click();
  } else if (action === 'next') {
    document.querySelector('.next-button')?.click();
  } else if (action === 'previous') {
    document.querySelector('.previous-button')?.click();
  } else if (action === 'like') {
    const likeContainer = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer .like');
    if (likeContainer) {
      const btnToClick = likeContainer.querySelector('button') || likeContainer;
      btnToClick.click();
    }
  }
});