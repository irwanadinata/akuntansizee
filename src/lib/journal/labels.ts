export function sourceAuditActionLabel(action:string){
  return ({CREATED:"dicatat",UPDATED:"diperbarui",REVERSED:"dibatalkan"}as Record<string,string>)[action]??action;
}
