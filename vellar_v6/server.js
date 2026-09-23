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

// ===============================
// VELLAR FOUNDER
// ===============================
const ADMIN_ID = String(process.env.ADMIN_ID || '').trim();

const DEV_MODE =
  String(process.env.DEV_MODE || 'false').toLowerCase() === 'true';

const CITIZENSHIP_STARS =
  Number(process.env.CITIZENSHIP_STARS || 500);

const SESSION_DAYS =
  Number(process.env.SESSION_DAYS || 7);

const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || '';

const DB_FILE =
  path.join(__dirname, 'data', 'vellar.json');

const YEAR = 365.25 * 24 * 3600;

// ===============================
// DATABASE
// ===============================

fs.mkdirSync(path.dirname(DB_FILE), {recursive:true});

let db =
  fs.existsSync(DB_FILE)
    ? JSON.parse(fs.readFileSync(DB_FILE,'utf8'))
    : {
        users:{},
        payments:{},
        sessions:{}
      };

function save(){
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db,null,2)
  );
}

function now(){
  return Date.now();
}

function id(){
  return crypto.randomUUID();
}

function num(v){
  return Number(v);
}

function userKey(tgId){
  return String(tgId);
}

// ===============================
// USER
// ===============================

function isFounder(tgId){
  return (
    ADMIN_ID &&
    String(tgId) === String(ADMIN_ID)
  );
}

function newUser(tg){

  const founder = isFounder(tg.id);

  return {

    telegramId:String(tg.id),

    username:
      tg.username || '',

    firstName:
      tg.first_name || '',

    language:
      tg.language_code || 'en',

    // ===========================
    // CITIZENSHIP
    // ===========================

    citizen: founder,

    citizenshipType:
      founder ? 'founder' : null,

    citizenshipPaid:
      founder ? false : null,

    citizenshipSource:
      founder ? 'founder' : null,

    // ===========================
    // ECONOMY
    // ===========================

    vel:5000,

    plots:{},

    deposits:[],

    loans:[],

    collateral:{
      usdt:0,
      sa:0
    },

    // ===========================
    // WALLET
    // ===========================

    wallet:'',

    walletNetwork:null,

    walletConnectedAt:null,

    // ===========================
    // WORKERS
    // ===========================

    workers:0,

    lastTick:now(),

    events:[
      `Account created for Telegram ${tg.id}`,
      ...(founder
        ? ['Founder citizenship granted automatically']
        : [])
    ]
  };
}

// ===============================
// FOUNDER ENFORCEMENT
// ===============================
//
// This function is deliberately
// called every time the user logs in.
// Therefore an already-created account
// with citizen:false is automatically
// upgraded to Founder.
//

function ensureFounder(u){

  if(
    ADMIN_ID &&
    String(u.telegramId) === String(ADMIN_ID)
  ){

    u.citizen = true;

    u.citizenshipType = 'founder';

    u.citizenshipPaid = false;

    u.citizenshipSource = 'founder';

    return true;
  }

  return false;
}

// ===============================
// GAME ECONOMY
// ===============================

function productionRate(u){

  return Object
    .values(u.plots || {})
    .reduce(
      (s,p) =>
        s + (
          p?.owned
            ? (p.rate || 0)
            : 0
        ),
      0
    );
}

function accrue(u){

  const t = now();

  const dt =
    Math.max(
      0,
      (t - (u.lastTick || t))
      / 3600000
    );

  if(dt > 0){

    u.vel +=
      productionRate(u) * dt;
  }

  u.lastTick = t;
}

function depositAcc(d){

  return d.status === 'open'
    ? d.principal *
      d.apy *
      Math.max(
        0,
        now() - d.openedAt
      ) /
      1000 /
      YEAR
    : 0;
}

function loanAcc(l){

  return l.status === 'open'
    ? l.principal *
      l.apy *
      Math.max(
        0,
        now() - l.openedAt
      ) /
      1000 /
      YEAR
    : 0;
}

// ===============================
// SAFE USER
// ===============================

function safeUser(u){

  ensureFounder(u);

  accrue(u);

  return {

    telegramId:u.telegramId,

    username:u.username,

    firstName:u.firstName,

    language:u.language,

    citizen:u.citizen,

    citizenshipType:
      u.citizenshipType || null,

    citizenshipPaid:
      u.citizenshipPaid ?? null,

    citizenshipSource:
      u.citizenshipSource || null,

    vel:u.vel,

    plots:u.plots,

    deposits:u.deposits,

    loans:u.loans,

    collateral:u.collateral,

    wallet:u.wallet,

    walletNetwork:
      u.walletNetwork || null,

    walletConnectedAt:
      u.walletConnectedAt || null,

    workers:u.workers,

    lastTick:u.lastTick,

    productionRate:
      productionRate(u),

    events:
      u.events.slice(0,50)
  };
}

function log(u,s){

  u.events.unshift(
    new Date().toISOString() +
    ` — ${s}`
  );

  u.events =
    u.events.slice(0,80);
}

// ===============================
// TELEGRAM AUTH
// ===============================

function validateTelegramInitData(initData){

  if(!BOT_TOKEN)
    throw new Error(
      'BOT_TOKEN is not configured'
    );

  const params =
    new URLSearchParams(initData);

  const hash =
    params.get('hash');

  if(!hash)
    throw new Error(
      'Missing Telegram hash'
    );

  const pairs = [];

  for(
    const [k,v]
    of params.entries()
  ){

    if(k !== 'hash')
      pairs.push(`${k}=${v}`);
  }

  pairs.sort();

  const dataCheckString =
    pairs.join('\n');

  const secret =
    crypto
      .createHmac(
        'sha256',
        'WebAppData'
      )
      .update(BOT_TOKEN)
      .digest();

  const calculated =
    crypto
      .createHmac(
        'sha256',
        secret
      )
      .update(dataCheckString)
      .digest('hex');

  if(
    calculated.length !== hash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(calculated),
      Buffer.from(hash)
    )
  ){

    throw new Error(
      'Invalid Telegram initData'
    );
  }

  const authDate =
    Number(
      params.get('auth_date') || 0
    );

  if(
    !authDate ||
    (Date.now()/1000 - authDate) > 86400
  ){

    throw new Error(
      'Expired Telegram initData'
    );
  }

  const tg =
    JSON.parse(
      params.get('user') || '{}'
    );

  if(!tg.id)
    throw new Error(
      'Telegram user missing'
    );

  return tg;
}

// ===============================
// SESSION
// ===============================

function issueSession(u){

  const token =
    crypto.randomBytes(32)
      .toString('hex');

  db.sessions[token] = {

    telegramId:u.telegramId,

    expiresAt:
      now() +
      SESSION_DAYS *
      86400000
  };

  save();

  return token;
}

function auth(req,res,next){

  const token =
    (req.headers.authorization || '')
      .replace(
        /^Bearer\s+/,
        ''
      );

  const s =
    db.sessions[token];

  if(
    !s ||
    s.expiresAt < now()
  ){

    return res.status(401)
      .json({
        error:'AUTH_REQUIRED'
      });
  }

  const u =
    db.users[s.telegramId];

  if(!u){

    return res.status(401)
      .json({
        error:'AUTH_REQUIRED'
      });
  }

  ensureFounder(u);

  req.user = u;

  req.session = token;

  next();
}

// ===============================
// TELEGRAM API
// ===============================

async function telegramApi(
  method,
  body
){

  if(!BOT_TOKEN)
    throw new Error(
      'BOT_TOKEN is not configured'
    );

  const r =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method:'POST',

        headers:{
          'content-type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );

  const j =
    await r.json();

  if(!j.ok)
    throw new Error(
      j.description ||
      'Telegram API error'
    );

  return j.result;
}

// ===============================
// HEALTH
// ===============================

app.get(
  '/api/health',
  (req,res) =>
    res.json({

      ok:true,

      version:'6.0.1',

      devMode:DEV_MODE,

      telegramConfigured:
        !!BOT_TOKEN,

      citizenshipStars:
        CITIZENSHIP_STARS,

      botUsername:
        BOT_USERNAME,

      appUrl:
        process.env.APP_URL || null,

      tonConfigured:
        !!process.env.PROJECT_WALLET_ADDRESS,

      saMaster:
        process.env.SA_MASTER_ADDRESS || null,

      founderConfigured:
        !!ADMIN_ID
    })
);

// ===============================
// TON CONNECT MANIFEST
// ===============================

app.get(
  '/tonconnect-manifest.json',
  (req,res)=>{

    const base =
      process.env.APP_URL ||
      `${req.protocol}://${req.get('host')}`;

    res.json({

      url:base,

      name:'Vellar',

      iconUrl:
        `${base}/assets/sa.png`,

      termsOfUseUrl:
        process.env.TERMS_URL ||
        undefined,

      privacyPolicyUrl:
        process.env.PRIVACY_URL ||
        undefined
    });
  }
);

// ===============================
// TON CONFIG
// ===============================

app.get(
  '/api/ton/config',
  (req,res)=>
    res.json({

      projectWallet:
        process.env.PROJECT_WALLET_ADDRESS ||
        null,

      saMaster:
        process.env.SA_MASTER_ADDRESS ||
        null,

      network:'-239'
    })
);

// ===============================
// DEV LOGIN
// ===============================

app.post(
  '/api/dev/login',
  (req,res)=>{

    if(!DEV_MODE){

      return res.status(403)
        .json({
          error:'DEV_MODE_DISABLED'
        });
    }

    const tg = {

      id:'dev-user',

      username:'vellar_test',

      first_name:'Test Citizen',

      language_code:'en'
    };

    let u =
      db.users[tg.id];

    if(!u){

      u = newUser(tg);

      db.users[tg.id] = u;
    }

    const session =
      issueSession(u);

    save();

    res.json({

      session,

      user:safeUser(u)
    });
  }
);

// ===============================
// TELEGRAM AUTH
// ===============================

app.post(
  '/api/auth/telegram',
  (req,res)=>{

    try{

      const tg =
        validateTelegramInitData(
          req.body.initData || ''
        );

      const k =
        userKey(tg.id);

      let u =
        db.users[k];

      // ---------------------------
      // CREATE USER
      // ---------------------------

      if(!u){

        u = newUser(tg);

        db.users[k] = u;

      }else{

        u.username =
          tg.username ||
          u.username;

        u.firstName =
          tg.first_name ||
          u.firstName;

        u.language =
          tg.language_code ||
          u.language;
      }

      // ---------------------------
      // FOUNDER
      // ---------------------------

      const founder =
        ensureFounder(u);

      if(founder){

        // Add event only once
        const alreadyLogged =
          u.events.some(
            e =>
              e.includes(
                'Founder citizenship'
              )
          );

        if(!alreadyLogged){

          log(
            u,
            'Founder citizenship granted automatically'
          );
        }
      }

      accrue(u);

      const session =
        issueSession(u);

      save();

      res.json({

        session,

        user:safeUser(u)
      });

    }catch(e){

      console.error(
        'Telegram auth error:',
        e
      );

      res.status(401)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// CURRENT USER
// ===============================

app.get(
  '/api/me',
  auth,
  (req,res)=>{

    ensureFounder(req.user);

    save();

    res.json({
      user:safeUser(req.user)
    });
  }
);

// ===============================
// DEV CITIZENSHIP
// ===============================

app.post(
  '/api/dev/grant-citizenship',
  auth,
  (req,res)=>{

    if(!DEV_MODE){

      return res.status(403)
        .json({
          error:'DEV_MODE_DISABLED'
        });
    }

    accrue(req.user);

    req.user.citizen = true;

    req.user.citizenshipType =
      'dev';

    req.user.citizenshipPaid =
      false;

    req.user.citizenshipSource =
      'dev';

    log(
      req.user,
      'Citizenship granted in DEV_MODE'
    );

    save();

    res.json({
      user:safeUser(req.user)
    });
  }
);

// ===============================
// CITIZENSHIP — TELEGRAM STARS
// ===============================

app.post(
  '/api/citizenship/stars/invoice',
  auth,
  async(req,res)=>{

    try{

      // =========================
      // FOUNDER PROTECTION
      // =========================

      if(
        ADMIN_ID &&
        String(req.user.telegramId) ===
        String(ADMIN_ID)
      ){

        ensureFounder(req.user);

        save();

        return res.status(400)
          .json({
            error:
              'FOUNDER_ALREADY_CITIZEN'
          });
      }

      if(req.user.citizen){

        return res.status(400)
          .json({
            error:
              'ALREADY_CITIZEN'
          });
      }

      const payload =
        `citizenship:${req.user.telegramId}:${id()}`;

      const invoice =
        await telegramApi(
          'createInvoiceLink',
          {

            title:
              'Vellar Citizenship',

            description:
              'Access to the Vellar game and state economy.',

            payload,

            currency:'XTR',

            prices:[
              {
                label:
                  'Citizenship',

                amount:
                  CITIZENSHIP_STARS
              }
            ],

            start_parameter:
              'vellar_citizenship'
          }
        );

      db.payments[payload] = {

        telegramId:
          req.user.telegramId,

        status:'created',

        type:'citizenship',

        createdAt:now()
      };

      save();

      res.json({

        invoiceUrl:invoice,

        stars:
          CITIZENSHIP_STARS
      });

    }catch(e){

      console.error(
        'Stars invoice error:',
        e
      );

      res.status(500)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// TELEGRAM WEBHOOK
// ===============================

app.post(
  '/api/telegram/webhook',
  async(req,res)=>{

    try{

      if(
        WEBHOOK_SECRET &&
        req.headers[
          'x-telegram-bot-api-secret-token'
        ] !== WEBHOOK_SECRET
      ){

        return res.sendStatus(403);
      }

      const update =
        req.body;

      // =========================
      // PRE CHECKOUT
      // =========================

      if(update.pre_checkout_query){

        const q =
          update.pre_checkout_query;

        const payment =
          db.payments[
            q.invoice_payload
          ];

        const ok =
          !!payment &&
          payment.status === 'created' &&
          String(
            payment.telegramId
          ) ===
          String(q.from?.id) &&
          q.currency === 'XTR' &&
          Number(q.total_amount) ===
          CITIZENSHIP_STARS;

        await telegramApi(
          'answerPreCheckoutQuery',
          {

            pre_checkout_query_id:
              q.id,

            ok,

            ...(
              !ok
                ? {
                    error_message:
                      'Vellar payment could not be verified.'
                  }
                : {}
            )
          }
        );
      }

      // =========================
      // START
      // =========================

      if(update.message?.text){

        const chatId =
          update.message.chat.id;

        const text =
          String(
            update.message.text || ''
          );

        if(
          text === '/start' ||
          text.startsWith('/start ') ||
          text === '/help'
        ){

          const appUrl =
            process.env.APP_URL || '';

          const kb =
            appUrl
              ? {
                  inline_keyboard:[
                    [
                      {
                        text:
                          'Open Vellar',

                        web_app:{
                          url:appUrl
                        }
                      }
                    ]
                  ]
                }
              : undefined;

          await telegramApi(
            'sendMessage',
            {

              chat_id:chatId,

              text:
                'VELLAR\n\n' +
                'Digital state, territory and economy.\n\n' +
                'Open the Mini App to continue.\n\n' +
                'Citizenship is required for gameplay. You can buy it in Telegram Stars inside the Mini App.',

              reply_markup:kb
            }
          );
        }
      }

      // =========================
      // SUCCESSFUL PAYMENT
      // =========================

      if(
        update.message?.successful_payment
      ){

        const p =
          update.message
            .successful_payment;

        const payment =
          db.payments[
            p.invoice_payload
          ];

        if(
          payment &&
          payment.status !== 'paid' &&
          p.currency === 'XTR' &&
          Number(p.total_amount) ===
          CITIZENSHIP_STARS
        ){

          payment.status =
            'paid';

          payment.chargeId =
            p.telegram_payment_charge_id;

          payment.paidAt =
            now();

          const user =
            db.users[
              payment.telegramId
            ];

          if(user){

            user.citizen = true;

            user.citizenshipType =
              'paid';

            user.citizenshipPaid =
              true;

            user.citizenshipSource =
              'telegram_stars';

            log(
              user,
              'Citizenship confirmed by Telegram Stars payment'
            );
          }

          save();
        }
      }

      res.json({
        ok:true
      });

    }catch(e){

      console.error(
        'Webhook error:',
        e
      );

      res.status(500)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// GAME ACTION
// ===============================

app.post(
  '/api/game/action',
  auth,
  (req,res)=>{

    try{

      const u =
        req.user;

      ensureFounder(u);

      accrue(u);

      if(!u.citizen){

        return res.status(403)
          .json({
            error:
              'CITIZENSHIP_REQUIRED'
          });
      }

      const a =
        req.body.action;

      // =========================
      // LAND
      // =========================

      if(a === 'buyLand'){

        const plot =
          String(req.body.plot);

        if(
          u.plots[plot]?.owned
        ){

          throw Error(
            'ALREADY_OWNED'
          );
        }

        if(u.vel < 200){

          throw Error(
            'INSUFFICIENT_VEL'
          );
        }

        u.vel -= 200;

        u.plots[plot] = {

          owned:true
        };

        log(
          u,
          `Purchased 1 ha #${plot}`
        );
      }

      // =========================
      // BUILD
      // =========================

      else if(a === 'build'){

        const plot =
          String(req.body.plot);

        const type =
          req.body.type;

        const cfg = {

          mine:[
            1000,
            2.5
          ],

          factory:[
            2500,
            7
          ],

          market:[
            1800,
            4
          ],

          bank:[
            5000,
            0
          ]

        }[type];

        if(!cfg)
          throw Error(
            'BAD_BUILDING'
          );

        if(
          !u.plots[plot]?.owned
        ){

          throw Error(
            'LAND_REQUIRED'
          );
        }

        if(
          u.plots[plot].building
        ){

          throw Error(
            'PLOT_OCCUPIED'
          );
        }

        if(
          u.vel < cfg[0]
        ){

          throw Error(
            'INSUFFICIENT_VEL'
          );
        }

        u.vel -= cfg[0];

        u.plots[plot] = {

          ...u.plots[plot],

          building:type,

          rate:cfg[1],

          builtAt:now()
        };

        log(
          u,
          `${type.toUpperCase()} constructed on #${plot}`
        );
      }

      // =========================
      // HIRE
      // =========================

      else if(a === 'hire'){

        if(u.vel < 100){

          throw Error(
            'INSUFFICIENT_VEL'
          );
        }

        u.vel -= 100;

        u.workers =
          (u.workers || 0) + 1;

        log(
          u,
          'Hired worker'
        );
      }

      else{

        throw Error(
          'UNKNOWN_ACTION'
        );
      }

      save();

      res.json({
        user:safeUser(u)
      });

    }catch(e){

      res.status(400)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// BANK — DEPOSIT
// ===============================

app.post(
  '/api/bank/deposit/open',
  auth,
  (req,res)=>{

    try{

      const u =
        req.user;

      ensureFounder(u);

      accrue(u);

      if(!u.citizen){

        return res.status(403)
          .json({
            error:
              'CITIZENSHIP_REQUIRED'
          });
      }

      const principal =
        num(req.body.amount);

      const apy =
        num(req.body.apy);

      const termDays =
        num(req.body.termDays);

      if(
        !(principal > 0) ||
        principal > u.vel
      ){

        throw Error(
          'INVALID_AMOUNT'
        );
      }

      if(
        !(apy > 0) ||
        termDays <= 0
      ){

        throw Error(
          'INVALID_TERMS'
        );
      }

      u.vel -= principal;

      u.deposits.push({

        id:id(),

        principal,

        apy,

        termDays,

        openedAt:now(),

        status:'open'
      });

      log(
        u,
        `Opened VEL deposit ${principal}`
      );

      save();

      res.json({
        user:safeUser(u)
      });

    }catch(e){

      res.status(400)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// BANK — CLOSE DEPOSIT
// ===============================

app.post(
  '/api/bank/deposit/close',
  auth,
  (req,res)=>{

    try{

      const u =
        req.user;

      ensureFounder(u);

      accrue(u);

      const d =
        u.deposits.find(
          x =>
            x.id === req.body.id &&
            x.status === 'open'
        );

      if(!d)
        throw Error(
          'DEPOSIT_NOT_FOUND'
        );

      const payout =
        d.principal +
        depositAcc(d);

      d.status =
        'closed';

      d.closedAt =
        now();

      u.vel +=
        payout;

      log(
        u,
        `Closed deposit; payout ${payout.toFixed(2)} VEL`
      );

      save();

      res.json({
        user:safeUser(u)
      });

    }catch(e){

      res.status(400)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// BANK — LOAN
// ===============================

app.post(
  '/api/bank/loan/open',
  auth,
  (req,res)=>{

    try{

      const u =
        req.user;

      ensureFounder(u);

      accrue(u);

      if(!u.citizen){

        return res.status(403)
          .json({
            error:
              'CITIZENSHIP_REQUIRED'
          });
      }

      const kind =
        req.body.kind === 'sa'
          ? 'sa'
          : 'usdt';

      const amount =
        num(req.body.amount);

      const price =
        num(req.body.price);

      const loan =
        num(req.body.loan);

      const apy =
        num(
          req.body.apy || 0.30
        );

      if(
        !(amount > 0 &&
          price > 0 &&
          loan > 0)
      ){

        throw Error(
          'INVALID_LOAN'
        );
      }

      const value =
        amount * price;

      const max =
        value * 0.5;

      if(loan > max){

        throw Error(
          `LTV_LIMIT:${max}`
        );
      }

      u.collateral[kind] =
        (u.collateral[kind] || 0)
        + amount;

      u.loans.push({

        id:id(),

        kind,

        amount,

        price,

        principal:loan,

        apy,

        openedAt:now(),

        status:'open'
      });

      u.vel += loan;

      log(
        u,
        `Borrowed ${loan} VEL against ${amount} ${kind.toUpperCase()}`
      );

      save();

      res.json({
        user:safeUser(u)
      });

    }catch(e){

      res.status(400)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// BANK — REPAY LOAN
// ===============================

app.post(
  '/api/bank/loan/repay',
  auth,
  (req,res)=>{

    try{

      const u =
        req.user;

      ensureFounder(u);

      accrue(u);

      const l =
        u.loans.find(
          x =>
            x.id === req.body.id &&
            x.status === 'open'
        );

      if(!l)
        throw Error(
          'LOAN_NOT_FOUND'
        );

      const debt =
        l.principal +
        loanAcc(l);

      if(u.vel < debt){

        throw Error(
          'INSUFFICIENT_VEL'
        );
      }

      u.vel -= debt;

      u.collateral[l.kind] -=
        l.amount;

      l.status =
        'closed';

      l.closedAt =
        now();

      log(
        u,
        `Loan repaid ${debt.toFixed(2)} VEL`
      );

      save();

      res.json({
        user:safeUser(u)
      });

    }catch(e){

      res.status(400)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// TON WALLET
// ===============================

app.post(
  '/api/wallet/attach',
  auth,
  (req,res)=>{

    try{

      const wallet =
        String(
          req.body.wallet || ''
        );

      const network =
        String(
          req.body.network ||
          '-239'
        );

      if(
        !/^[-A-Za-z0-9_]{30,80}$/
          .test(wallet)
      ){

        throw Error(
          'BAD_WALLET'
        );
      }

      req.user.wallet =
        wallet;

      req.user.walletNetwork =
        network;

      req.user.walletConnectedAt =
        now();

      log(
        req.user,
        `TON wallet connected: ${wallet.slice(0,8)}…${wallet.slice(-6)}`
      );

      save();

      res.json({
        user:safeUser(req.user)
      });

    }catch(e){

      res.status(400)
        .json({
          error:e.message
        });
    }
  }
);

// ===============================
// STATIC FILES
// ===============================

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);

app.get(
  '/{*splat}',
  (req,res)=>
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    )
);

// ===============================
// START
// ===============================

app.listen(
  PORT,
  ()=>{
    console.log(
      `Vellar v6.0.1 running on http://localhost:${PORT}`
    );

    console.log(
      `Founder ID configured: ${ADMIN_ID ? 'YES' : 'NO'}`
    );
  }
);
