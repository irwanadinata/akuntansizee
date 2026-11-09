// Runs the real Prisma/Neon adapter against a disposable local PostgreSQL cluster.
// Environment files and the configured application database are never changed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {execFileSync,spawn,spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
const require=createRequire(import.meta.url),{WebSocketServer}=require("next/dist/compiled/ws");
const bin=process.env.PG_BIN??(process.platform==="win32"?"C:/Program Files/PostgreSQL/17/bin":spawnSync("pg_config",["--bindir"],{encoding:"utf8"}).stdout?.trim());
assert.ok(bin&&fs.existsSync(path.join(bin,process.platform==="win32"?"initdb.exe":"initdb")),"PostgreSQL binaries are required; set PG_BIN to their bin directory.");
const executable=name=>path.join(bin,name+(process.platform==="win32"?".exe":""));
const cache=path.resolve(".npm-cache"),directory=path.join(cache,"local-postgres-"+randomUUID()),data=path.join(directory,"data");
assert.ok(directory.startsWith(cache+path.sep));fs.mkdirSync(directory,{recursive:true});
const portServer=net.createServer();await new Promise(resolve=>portServer.listen(0,"127.0.0.1",resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
let pg,proxy,child,exitCode=1,logs="";
try{
 execFileSync(executable("initdb"),["-D",data,"-A","trust","-U","qa","--no-locale","-E","UTF8"],{windowsHide:true,stdio:"pipe"});
 pg=spawn(executable("postgres"),["-D",data,"-h","127.0.0.1","-p",String(port)],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
 let ready;const started=new Promise(resolve=>{ready=resolve});pg.stderr.on("data",chunk=>{logs=(logs+chunk).slice(-12000);if(String(chunk).includes("ready to accept connections"))ready();});
 await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error("Local PostgreSQL did not start")),15000))]);
 proxy=new WebSocketServer({host:"127.0.0.1",port:0});await new Promise(resolve=>proxy.on("listening",resolve));
 proxy.on("connection",client=>{const socket=net.createConnection({host:"127.0.0.1",port});client.on("message",chunk=>socket.write(chunk));socket.on("data",chunk=>{if(client.readyState===1)client.send(chunk)});socket.on("error",()=>client.close());client.on("close",()=>socket.destroy());socket.on("close",()=>client.close());});
 const direct="postgresql://qa:qa@ep-local-qa.ap-southeast-1.aws.neon.tech:"+port+"/postgres?sslmode=require";
 const env={...process.env,LOCAL_PG_TEST:"1",LOCAL_PG_PROXY:"127.0.0.1:"+proxy.address().port,DIRECT_URL:direct,DATABASE_URL:direct.replace("ep-local-qa.","ep-local-qa-pooler.")};
 for(const prefix of["COA","JOURNAL","LOAN","TRADE","REPORT","OPENING"]){env[prefix+"_TEST_DIRECT_URL"]=direct;env[prefix+"_TEST_CONFIRM"]="CREATE_TEMP_SCHEMA";}
 const files=fs.readdirSync("tests/integration").filter(name=>name.endsWith(".test.ts")).sort().map(name=>"tests/integration/"+name);
 console.info("Running all integration suites on a disposable local PostgreSQL cluster; no application database is used.");
 child=spawn(process.execPath,["--conditions=react-server","--import",pathToFileURL(path.resolve("tests/integration/local-postgres-setup.mjs")).href,"--import","tsx","--test","--test-concurrency=2",...files],{env,windowsHide:true,stdio:"inherit"});
 exitCode=await new Promise(resolve=>child.on("exit",code=>resolve(code??1)));
}catch(error){console.error(error.message);if(logs)console.error(logs);}
finally{
 if(child?.exitCode===null)child.kill();
 if(proxy){for(const client of proxy.clients)client.terminate();await new Promise(resolve=>proxy.close(resolve));}
 if(pg?.exitCode===null){try{execFileSync(executable("pg_ctl"),["-D",data,"-m","fast","stop"],{windowsHide:true,stdio:"pipe"});}catch{pg.kill();}}
 const target=path.resolve(directory);assert.ok(target.startsWith(cache+path.sep)&&/^local-postgres-[a-f0-9-]+$/.test(path.basename(target)));fs.rmSync(target,{recursive:true,force:true});
}
process.exitCode=exitCode;
