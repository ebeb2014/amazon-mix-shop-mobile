import {build} from 'esbuild';
await build({entryPoints:['src/auth.js'],outfile:'auth.js',bundle:true,format:'esm',minify:true,target:['safari16','chrome110'],legalComments:'linked'});
