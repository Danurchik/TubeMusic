const pngToIco = require('png-to-ico');
const fs = require('fs');

// Конвертируем PNG в ICO со всеми нужными размерами, включая 256x256
pngToIco('Youtube_Music_icon-Photoroom.png')
  .then(buffer => {
    fs.writeFileSync('icon.ico', buffer);
    console.log('Успешно! Правильный файл icon.ico создан.');
  })
  .catch(console.error);