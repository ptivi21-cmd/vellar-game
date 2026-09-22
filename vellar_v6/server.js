import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:false}));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_USERNAME = process.env.BOT_USERNAME || 'VellarCitizenBot';
const DEV_MODE = String(process.env.DEV_MODE || 'false').toLowerCase() === 'true';
const CITIZENSHIP_STARS = Number(process.env.CITIZENSHIP_STARS || 500);
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const DB_FILE = path.join(__dirname, 'data', 'vellar.json');
const YEAR = 365.25*24*3600;

fs.mkdirSync(path.dirname(DB_FILE), {recursive:true});
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE,'utf8')) : {users:{}, payments:{}, sessions:{}};
function save(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function now(){ return Date.now(); }
function id(){ return crypto.randomUUID(); }
function num(v){ return Number(v); }
function userKey(tgId){ return String(tgId); }
function newUser(tg){ return {telegramId:String(tg.id), username:tg.username||'', firstName:tg.first_name||'', language:tg.language_code||'en', citizen:false, vel:5000, plots:{}, deposits:[], loans:[], collateral:{usdt:0,sa:0}, wallet:'', walletNetwork:null, walletConnectedAt:null, workers:0, lastTick:now(), events:[`Account created for Telegram ${tg.id}`]}; }
function productionRate(u){ return Object.values(u.plots||{}).reduce((s,p)=>s+(p?.owned?(p.rate||0):0),0); }
function accrue(u){ const t=now(); const dt=Math.max(0,(t-(u.lastTick||t))/3600000); if(dt>0) u.vel += productionRate(u)*dt; u.lastTick=t; }
function depositAcc(d){ return d.status==='open' ? d.principal*d.apy*Math.max(0,now()-d.openedAt)/1000/YEAR : 0; }
function loanAcc(l){ return l.status==='open' ? l.principal*l.apy*Math.max(0,now()-l.openedAt)/1000/YEAR : 0; }
function safeUser(u){
  accrue(u);
  return {telegramId:u.telegramId,username:u.username,firstName:u.firstName,language:u.language,citizen:u.citizen,vel:u.vel,plots:u.plots,deposits:u.deposits,loans:u.loans,collateral:u.collateral,wallet:u.wallet,walletNetwork:u.walletNetwork||null,walletConnectedAt:u.walletConnectedAt||null,workers:u.workers,lastTick:u.lastTick,productionRate:productionRate(u),events:u.events.slice(0,50),citizenshipSource:u.citizenshipSource||null};
}
function log(u,s){ u.events.unshift(new Date().toISOString()+` — ${s}`); u.events=u.events.slice(0,80); }
function validateTelegramInitData(initData){
  if(!BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if(!hash) throw new Error('Missing Telegram hash');
  const pairs=[]; for(const [k,v] of params.entries()) if(k!=='hash') pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString=pairs.join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const calculated=crypto.createHmac('sha256',secret).update(dataCheckString).digest('hex');
  if(calculated.length!==hash.length || !crypto.timingSafeEqual(Buffer.from(calculated),Buffer.from(hash))) throw new Error('Invalid Telegram initData');
  const authDate=Number(params.get('auth_date')||0);
  if(!authDate || (Date.now()/1000-authDate)>86400) throw new Error('Expired Telegram initData');
  const tg=JSON.parse(params.get('user')||'{}'); if(!tg.id) throw new Error('Telegram user missing');
  return tg;
}
function issueSession(u){ const token=crypto.randomBytes(32).toString('hex'); db.sessions[token]={telegramId:u.telegramId,expiresAt:now()+SESSION_DAYS*86400000}; save(); return token; }
function auth(req,res,next){ const token=(req.headers.authorization||'').replace(/^Bearer\s+/,''); const s=db.sessions[token]; if(!s||s.expiresAt<now()) return res.status(401).json({error:'AUTH_REQUIRED'}); const u=db.users[s.telegramId]; if(!u) return res.status(401).json({error:'AUTH_REQUIRED'}); req.user=u; req.session=token; next(); }
async function telegramApi(method, body){
  if(!BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json(); if(!j.ok) throw new Error(j.description||'Telegram API error'); return j.result;
}

app.get('/api/health',(req,res)=>res.json({ok:true,version:'6.0.0',devMode:DEV_MODE,telegramConfigured:!!BOT_TOKEN,citizenshipStars:CITIZENSHIP_STARS,botUsername:BOT_USERNAME,appUrl:process.env.APP_URL||null,tonConfigured:!!process.env.PROJECT_WALLET_ADDRESS,saMaster:process.env.SA_MASTER_ADDRESS||null}));
app.get('/tonconnect-manifest.json',(req,res)=>{res.json({url:process.env.APP_URL||`${req.protocol}://${req.get('host')}`,name:'Vellar',iconUrl:`${process.env.APP_URL||`${req.protocol}://${req.get('host')}`}/assets/sa.png`,termsOfUseUrl:process.env.TERMS_URL||undefined,privacyPolicyUrl:process.env.PRIVACY_URL||undefined});});
app.get('/api/ton/config',(req,res)=>res.json({projectWallet:process.env.PROJECT_WALLET_ADDRESS||null,saMaster:process.env.SA_MASTER_ADDRESS||null,network:'-239'}));
app.post('/api/dev/login',(req,res)=>{ if(!DEV_MODE)return res.status(403).json({error:'DEV_MODE_DISABLED'}); const tg={id:'dev-user',username:'vellar_test',first_name:'Test Citizen',language_code:'en'}; let u=db.users[tg.id]; if(!u){u=newUser(tg);db.users[tg.id]=u;} const session=issueSession(u); save(); res.json({session,user:safeUser(u)}); });
app.post('/api/auth/telegram',(req,res)=>{ try{ const tg=validateTelegramInitData(req.body.initData||''); const k=userKey(tg.id); let u=db.users[k]; if(!u){u=newUser(tg);db.users[k]=u;} else {u.username=tg.username||u.username;u.firstName=tg.first_name||u.firstName;u.language=tg.language_code||u.language;} accrue(u); const session=issueSession(u); save(); res.json({session,user:safeUser(u)}); }catch(e){res.status(401).json({error:e.message});} });
app.get('/api/me',auth,(req,res)=>{save();res.json({user:safeUser(req.user)});});
app.post('/api/dev/grant-citizenship',auth,(req,res)=>{ if(!DEV_MODE)return res.status(403).json({error:'DEV_MODE_DISABLED'}); accrue(req.user); req.user.citizen=true; req.user.citizenshipSource='dev'; log(req.user,'Citizenship granted in DEV_MODE'); save(); res.json({user:safeUser(req.user)}); });
app.post('/api/citizenship/stars/invoice',auth,async(req,res)=>{ try{ if(req.user.citizen)return res.status(400).json({error:'ALREADY_CITIZEN'}); const payload=`citizenship:${req.user.telegramId}:${id()}`; const invoice=await telegramApi('createInvoiceLink',{title:'Vellar Citizenship',description:'Access to the Vellar game and state economy.',payload,currency:'XTR',prices:[{label:'Citizenship',amount:CITIZENSHIP_STARS}],start_parameter:'vellar_citizenship'}); db.payments[payload]={telegramId:req.user.telegramId,status:'created',type:'citizenship',createdAt:now()}; save(); res.json({invoiceUrl:invoice,stars:CITIZENSHIP_STARS}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/telegram/webhook',async(req,res)=>{
  try{
    if(WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token']!==WEBHOOK_SECRET)return res.sendStatus(403);
    const update=req.body;
    if(update.pre_checkout_query){
      const q=update.pre_checkout_query;
      const payment=db.payments[q.invoice_payload];
      const ok=!!payment && payment.status==='created' && String(payment.telegramId)===String(q.from?.id) && q.currency==='XTR' && Number(q.total_amount)===CITIZENSHIP_STARS;
      await telegramApi('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok,...(!ok?{error_message:'Vellar payment could not be verified.'}:{})});
    }
    if(update.message?.text){
      const chatId=update.message.chat.id;
      const text=String(update.message.text||'');
      if(text==='/start' || text.startsWith('/start ') || text==='/help'){
        const appUrl=process.env.APP_URL||'';
        const kb=appUrl?{inline_keyboard:[[{text:'Open Vellar',web_app:{url:appUrl}}]]}:undefined;
        await telegramApi('sendMessage',{chat_id:chatId,text:'VELLAR\n\nDigital state, territory and economy.\n\nOpen the Mini App to continue.\n\nCitizenship is required for gameplay. You can buy it in Telegram Stars inside the Mini App.',reply_markup:kb});
      }
    }
    if(update.message?.successful_payment){
      const p=update.message.successful_payment;
      const payment=db.payments[p.invoice_payload];
      if(payment && payment.status!=='paid' && p.currency==='XTR' && Number(p.total_amount)===CITIZENSHIP_STARS){
        payment.status='paid'; payment.chargeId=p.telegram_payment_charge_id; payment.paidAt=now();
        const user=db.users[payment.telegramId];
        if(user){user.citizen=true;user.citizenshipSource='telegram_stars';log(user,'Citizenship confirmed by Telegram Stars payment');}
        save();
      }
    }
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/game/action',auth,(req,res)=>{ try{ const u=req.user; accrue(u); if(!u.citizen)return res.status(403).json({error:'CITIZENSHIP_REQUIRED'}); const a=req.body.action;
 if(a==='buyLand'){const plot=String(req.body.plot);if(u.plots[plot]?.owned)throw Error('ALREADY_OWNED');if(u.vel<200)throw Error('INSUFFICIENT_VEL');u.vel-=200;u.plots[plot]={owned:true};log(u,`Purchased 1 ha #${plot}`);}
 else if(a==='build'){const plot=String(req.body.plot),type=req.body.type;const cfg={mine:[1000,2.5],factory:[2500,7],market:[1800,4],bank:[5000,0]}[type];if(!cfg)throw Error('BAD_BUILDING');if(!u.plots[plot]?.owned)throw Error('LAND_REQUIRED');if(u.plots[plot].building)throw Error('PLOT_OCCUPIED');if(u.vel<cfg[0])throw Error('INSUFFICIENT_VEL');u.vel-=cfg[0];u.plots[plot]={...u.plots[plot],building:type,rate:cfg[1],builtAt:now()};log(u,`${type.toUpperCase()} constructed on #${plot}`);}
 else if(a==='hire'){if(u.vel<100)throw Error('INSUFFICIENT_VEL');u.vel-=100;u.workers=(u.workers||0)+1;log(u,'Hired worker');}
 else throw Error('UNKNOWN_ACTION'); save();res.json({user:safeUser(u)}); }catch(e){res.status(400).json({error:e.message});} });
app.post('/api/bank/deposit/open',auth,(req,res)=>{try{const u=req.user;accrue(u);if(!u.citizen)return res.status(403).json({error:'CITIZENSHIP_REQUIRED'});const principal=num(req.body.amount),apy=num(req.body.apy),termDays=num(req.body.termDays);if(!(principal>0)||principal>u.vel)throw Error('INVALID_AMOUNT');if(!(apy>0)||termDays<=0)throw Error('INVALID_TERMS');u.vel-=principal;u.deposits.push({id:id(),principal,apy,termDays,openedAt:now(),status:'open'});log(u,`Opened VEL deposit ${principal}`);save();res.json({user:safeUser(u)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/bank/deposit/close',auth,(req,res)=>{try{const u=req.user;accrue(u);const d=u.deposits.find(x=>x.id===req.body.id&&x.status==='open');if(!d)throw Error('DEPOSIT_NOT_FOUND');const payout=d.principal+depositAcc(d);d.status='closed';d.closedAt=now();u.vel+=payout;log(u,`Closed deposit; payout ${payout.toFixed(2)} VEL`);save();res.json({user:safeUser(u)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/bank/loan/open',auth,(req,res)=>{try{const u=req.user;accrue(u);const kind=req.body.kind==='sa'?'sa':'usdt',amount=num(req.body.amount),price=num(req.body.price),loan=num(req.body.loan),apy=num(req.body.apy||0.30);if(!(amount>0&&price>0&&loan>0))throw Error('INVALID_LOAN');const value=amount*price,max=value*.5;if(loan>max)throw Error(`LTV_LIMIT:${max}`);u.collateral[kind]=(u.collateral[kind]||0)+amount;u.loans.push({id:id(),kind,amount,price,principal:loan,apy,openedAt:now(),status:'open'});u.vel+=loan;log(u,`Borrowed ${loan} VEL against ${amount} ${kind.toUpperCase()}`);save();res.json({user:safeUser(u)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/bank/loan/repay',auth,(req,res)=>{try{const u=req.user;accrue(u);const l=u.loans.find(x=>x.id===req.body.id&&x.status==='open');if(!l)throw Error('LOAN_NOT_FOUND');const debt=l.principal+loanAcc(l);if(u.vel<debt)throw Error('INSUFFICIENT_VEL');u.vel-=debt;u.collateral[l.kind]-=l.amount;l.status='closed';l.closedAt=now();log(u,`Loan repaid ${debt.toFixed(2)} VEL`);save();res.json({user:safeUser(u)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/wallet/attach',auth,(req,res)=>{try{const wallet=String(req.body.wallet||'');const network=String(req.body.network||'-239');if(!/^[-A-Za-z0-9_]{30,80}$/.test(wallet))throw Error('BAD_WALLET');req.user.wallet=wallet;req.user.walletNetwork=network;req.user.walletConnectedAt=now();log(req.user,`TON wallet connected: ${wallet.slice(0,8)}…${wallet.slice(-6)}`);save();res.json({user:safeUser(req.user)});}catch(e){res.status(400).json({error:e.message});}});
app.use(express.static(path.join(__dirname,'public')));
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Vellar v6 running on http://localhost:${PORT}`));
