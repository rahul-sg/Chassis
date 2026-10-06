import {readFile,writeFile} from 'node:fs/promises';
import {Script} from 'node:vm';
const read=name=>readFile(new URL('./dist/'+name,import.meta.url),'utf8');
const sources=["scene.js", "app.js"];
let code=(await Promise.all(sources.map(read))).join('\n');
code=code.replace(/^import .*?;\n/gm,'').replace(/\bexport (?=(const|function|class)\b)/g,'');
new Script(code); // Validate the generated classic script before writing it.
const [html,css,icon]=await Promise.all(['index.html','style.css','favicon.svg'].map(read));
const output=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>').replace('<link rel="icon" href="favicon.svg">','<link rel="icon" href="data:image/svg+xml,'+encodeURIComponent(icon)+'">').replace('href="./"','href="#"').replace('<script type="module" src="app.js"></script>','<script>\n'+code+'\n</script>');
await writeFile(new URL('./Open Garage.html',import.meta.url),output);
console.log('Ready: Open Garage.html');
