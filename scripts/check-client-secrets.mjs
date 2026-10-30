import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { join,resolve } from "node:path";
import { loadLocalEnv } from "./load-env.ts";
loadLocalEnv();
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(join(path,item.name)):[join(path,item.name)]);}
const values=[];
for(const key of["DATABASE_URL","DIRECT_URL","AUTH_SECRET","SEED_ADMIN_PASSWORD"]){
  const value=process.env[key];if(!value||/REPLACE_WITH|PLACEHOLDER|ep-example/i.test(value))continue;
  values.push(value);
  if(key.endsWith("URL")){const url=new URL(value);values.push(url.hostname,decodeURIComponent(url.password));}
}
assert.ok(values.length>0,"Provide private env locally to check exact values; no secrets are printed.");
const chunks=files(resolve(".next/static")).filter(path=>/\.(js|json|map)$/.test(path));assert.ok(chunks.length>0);
const offenders=chunks.filter(path=>values.some(value=>readFileSync(path,"utf8").includes(value)));
assert.equal(offenders.length,0,"Private environment value found in client output; values intentionally omitted.");
const sourceFiles=["src","scripts","tests","docs","prisma"].flatMap(path=>files(resolve(path))).filter(path=>/\.(ts|tsx|js|mjs|json|md|sql|toml)$/.test(path)&&!path.includes(join("src","generated")));
sourceFiles.push(...[".env.example","README.md","next.config.ts","prisma.config.ts","package.json","tsconfig.json"].map(path=>resolve(path)));
assert.equal(sourceFiles.filter(path=>values.some(value=>readFileSync(path,"utf8").includes(value))).length,0,"Private local environment value found in distribution source; values intentionally omitted.");
console.info(JSON.stringify({clientFilesChecked:chunks.length,sourceFilesChecked:sourceFiles.length,secretValuesFound:0,credentialsPrinted:false}));
