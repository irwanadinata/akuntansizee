// Test-only WebSocket transport to an isolated PostgreSQL on loopback. Never imported by the application.
import {neonConfig} from "@neondatabase/serverless";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),{WebSocket}=require("next/dist/compiled/ws");
if(process.env.LOCAL_PG_TEST!=="1"||!/^127\.0\.0\.1:[0-9]{1,5}$/.test(process.env.LOCAL_PG_PROXY??""))throw new Error("Local PostgreSQL test transport requires an explicit loopback proxy.");
for(const config of new Set([neonConfig,require("@neondatabase/serverless").neonConfig])){
config.webSocketConstructor=WebSocket;config.wsProxy=()=>process.env.LOCAL_PG_PROXY;
config.useSecureWebSocket=false;config.forceDisablePgSSL=true;config.pipelineConnect=false;config.poolQueryViaFetch=false;
}
