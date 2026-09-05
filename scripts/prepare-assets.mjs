import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/pdfjs/', root), { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(fileURLToPath(new URL(`node_modules/pdfjs-dist/${name}`, root)), fileURLToPath(new URL(`public/pdfjs/${name}`, root)), { recursive: true });
}
const packages = ['react', 'react-dom', 'lucide-react', 'fflate', 'pdfjs-dist', '@fontsource-variable/geist', '@fontsource-variable/geist-mono'];
let notices = 'CUTLINE — OPEN-SOURCE LICENSES\n\n' + await readFile(new URL('LICENSE', root), 'utf8');
for (const name of packages) {
  notices += `\n\n${'='.repeat(72)}\n${name}\n${'='.repeat(72)}\n\n`;
  notices += await readFile(new URL(`node_modules/${name}/LICENSE`, root), 'utf8');
}
await writeFile(new URL('public/THIRD-PARTY-LICENSES.txt', root), notices);
