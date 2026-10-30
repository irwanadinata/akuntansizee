"use client";
import NextLink from "next/link";
import { forwardRef,type ComponentProps } from "react";
import { useFiscalHref } from "./use-fiscal-href";
import { useNavigationLoading } from "./loading/navigation-provider";
const YearLink=forwardRef<HTMLAnchorElement,ComponentProps<typeof NextLink>>(function YearLink({href,children,onNavigate,...props},ref){
  const scopedHref=useFiscalHref();
  const navigation=useNavigationLoading();
  const target=typeof href==="string"?scopedHref(href):href;
  return <NextLink {...props} href={target} ref={ref} onNavigate={event=>{
    let prevented=false;
    onNavigate?.({preventDefault:()=>{prevented=true;event.preventDefault();}});
    if(prevented||!navigation||typeof target!=="string")return;
    const url=new URL(target,window.location.href);
    if(url.origin!==window.location.origin||(url.pathname===window.location.pathname&&url.search===window.location.search))return;
    event.preventDefault();navigation.navigate(url.pathname+url.search+url.hash,props.replace,props.scroll);
  }}>{children}</NextLink>;
});
export default YearLink;
