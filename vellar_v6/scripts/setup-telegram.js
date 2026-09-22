import 'dotenv/config';
const token=process.env.BOT_TOKEN;
const appUrl=process.env.APP_URL;
const secret=process.env.WEBHOOK_SECRET;
if(!token) throw new Error('BOT_TOKEN is missing in .env');
if(!appUrl || !/^https:\/\//i.test(appUrl)) throw new Error('APP_URL must be a public HTTPS URL');
if(!secret) throw new Error('WEBHOOK_SECRET is missing in .env');
async function tg(method,body){
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json(); if(!j.ok) throw new Error(`${method}: ${j.description}`); return j.result;
}
await tg('setWebhook',{url:`${appUrl.replace(/\/$/,'')}/api/telegram/webhook`,secret_token:secret,allowed_updates:['message','pre_checkout_query']});
await tg('setMyCommands',{commands:[{command:'start',description:'Open Vellar'},{command:'help',description:'Vellar help'}]});
await tg('setChatMenuButton',{menu_button:{type:'web_app',text:'Open Vellar',web_app:{url:appUrl}}});
console.log('Telegram webhook + commands + menu button configured.');
