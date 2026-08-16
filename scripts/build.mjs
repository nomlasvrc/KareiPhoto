import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const files = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js'];
const directories = ['assets', 'src'];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  ...files.map((file) => cp(`${projectRoot}${file}`, `${outputDirectory}${file}`)),
  ...directories.map((directory) => cp(
    `${projectRoot}${directory}`,
    `${outputDirectory}${directory}`,
    { recursive: true },
  )),
]);

console.log(`GitHub Pages artifact created at ${outputDirectory}`);
