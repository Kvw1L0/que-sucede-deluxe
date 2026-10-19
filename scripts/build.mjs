import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of [
  'index.html',
  'admin.html',
  'app.js',
  'style.css',
  'fondo-hdc.webp',
  'demo.mp4',
  'demo-intro.mp4',
  'demo-reveal.mp4'
]) {
  await copyFile('cloud/public/' + name, 'dist/' + name);
}
