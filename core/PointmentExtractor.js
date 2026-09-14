// pointment-extractor.js
// Pure vanilla Node.js. Zero deps.
//
// Usage (programmatic):
//   import PointmentExtractor from './pointment-extractor.js';
//   const px = new PointmentExtractor({ temperature: 0.5 });
//   await px.loadEnglishBase();           // optional, built-in
//   await px.loadJSON('./dict.json');     // async file load
//   await px.loadJSONObject({ ... });     // async object load
//   if (px.isReady()) {
//     const out = px.extract('In the part of userService, do Y.');
//   }
//
// Usage (server):
//   import PointmentExtractor from './pointment-extractor.js';
//   const px = new PointmentExtractor();
//   await px.loadEnglishBase();
//   await px.loadJSON(process.argv[2]);
//   px.listen(3000);
//
// Usage (CLI):
//   node pointment-extractor.js dict.json
'use strict';

import http from 'node:http';
import url from 'node:url';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/* ============================================================================
 * NORMALIZATION + TOKENIZATION  (unchanged)
 * ==========================================================================*/

export function normalizeWord(w) {
  if (w === null || w === undefined) return '';
  if (typeof w !== 'string') w = String(w);
  return w
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .trim();
}

export function tokenizeText(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const re = /[A-Za-z][A-Za-z0-9'_-]*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = normalizeWord(m[0]);
    if (n) out.push(n);
    if (/[-_]/.test(m[0])) {
      for (const part of m[0].split(/[-_]+/)) {
        const p = normalizeWord(part);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/* ============================================================================
 * DICTIONARY  (unchanged logic)
 * ==========================================================================*/

export class Dictionary {
  constructor(name = 'default') {
    this.name = name;
    this.words = new Set();
    this.sources = [];
  }

  add(word) {
    const n = normalizeWord(word);
    if (!n) return false;
    const isNew = !this.words.has(n);
    this.words.add(n);
    return isNew;
  }

  addMany(words) {
    let n = 0;
    for (const w of words) if (this.add(w)) n++;
    return n;
  }

  has(word) {
    return this.words.has(normalizeWord(word));
  }

  size() { return this.words.size; }

  addJSON(value, source = 'json') {
    const seen = new WeakSet();
    const splitCamel = (s) =>
      String(s)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

    const visit = (v, depth) => {
      if (v === null || v === undefined) return;
      if (depth > 40) return;

      if (typeof v === 'object') {
        if (seen.has(v)) return;
        seen.add(v);

        if (Array.isArray(v)) {
          for (const item of v) visit(item, depth + 1);
          return;
        }

        for (const [k, val] of Object.entries(v)) {
          this.add(k);
          for (const piece of splitCamel(k).split(/[\s\-_]+/)) this.add(piece);
          visit(val, depth + 1);
        }
        return;
      }

      if (typeof v === 'string') {
        const whole = normalizeWord(v);
        if (whole && whole.length <= 40 && !/\s/.test(v.trim())) this.add(whole);
        for (const w of tokenizeText(v)) this.add(w);
        return;
      }

      if (typeof v === 'number') { this.add(String(v)); return; }
      if (typeof v === 'boolean') { this.add(String(v)); return; }
    };

    const before = this.words.size;
    visit(value, 0);
    const added = this.words.size - before;
    this.sources.push({ source, added, total: this.words.size });
    return added;
  }

  loadFile(filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    let raw;
    try { raw = fs.readFileSync(resolved, 'utf8'); }
    catch (e) { throw new Error(`Cannot read ${resolved}: ${e.message}`); }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new Error(`Invalid JSON in ${resolved}: ${e.message}`); }
    return this.addJSON(parsed, resolved);
  }

  // async variant — leaves sync loadFile untouched
  async loadFileAsync(filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    let raw;
    try { raw = await fsp.readFile(resolved, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') throw new Error(`File not found: ${resolved}`);
      throw new Error(`Cannot read ${resolved}: ${e.message}`);
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw new Error(`Invalid JSON in ${resolved}: ${e.message}`); }
    return this.addJSON(parsed, resolved);
  }
}

/* ============================================================================
 * ENGLISH BASE  (unchanged)
 * ==========================================================================*/

const ENGLISH_BASE_WORDS = `
a about above across act add after again against age ago agree air all allow
almost alone along already also although always among amount an and animal
another answer any appear apply area argue arm around arrive art as ask at
attack attempt attend attention author available avoid away baby back bad bag
ball bank bar base be bear beat beautiful because become bed before begin
behavior behind being believe below best better between beyond big bill bit
black block blood blue board boat body book born both box boy break bring
brother budget build building business but buy by call camera campaign can
candidate capital car card care career carry case catch cause cell center
central century certain certainly chair challenge chance change character
charge check child choice choose church citizen city civil claim class clear
close coach cold collection college color come commercial common community
company compare computer concern condition conference consider consumer
contain continue control cost could country couple course court cover create
crime cultural culture cup current customer cut dark data daughter day dead
deal death debate decade decide decision deep defense degree democratic
describe design despite detail determine develop development die difference
different difficult dinner direction director discover discuss discussion
disease do doctor dog door down draw dream drive drop drug during each early
east easy eat economic economy edge education effect effort eight either
election else employee end energy enjoy enough enter entire environment
especially establish even evening event ever every everyone everything
evidence exactly example executive exist expect experience expert explain
eye face fact factor fail fall family far fast father fear federal feel
feeling few field fight figure fill film final finally financial find fine
finger finish fire firm first fish five floor fly focus follow food foot for
force foreign forget form former forward four free friend from front full
fund future game garden general generation get girl give glass go goal good
government great green ground group grow growth guess gun guy hair half hand
hang happen happy hard have he head health hear heart heat heavy help her
here herself high him himself his history hit hold home hope hospital hot
hotel hour house how however huge human hundred husband idea identify if
image imagine impact important improve in include including increase indeed
indicate individual industry information inside instead institution interest
international interview into investment involve issue it item its itself job
join just keep key kid kill kind kitchen know knowledge land language large
last late later laugh law lawyer lay lead leader learn least leave left leg
legal less let letter level lie life light like likely line listen little
live local long look lose loss lot love low machine magazine main maintain
major make man manage management manager many market material matter may me
mean measure media medical meet meeting member memory mention message method
middle might military million mind minute miss mission model modern moment
money month more morning most mother mouth move movement movie much music
must my myself name nation national natural nature near nearly necessary
need network never new news newspaper next nice night no none nor north not
note nothing notice now number occur of off offer office officer official
often oil ok old on once one only open operation opportunity option or order
organization other others our out outside over own owner page pain painting
paper parent part participant particular particularly partner party pass
past patient pattern pay peace people per perform performance perhaps period
person personal phone physical pick picture piece place plan plant play
player point police policy political politics poor popular population
position positive possible power practice prepare present president pressure
pretty prevent price private probably problem process produce product
production professional professor program project property protect prove
provide public pull purpose push put quality question quickly quite race
radio raise range rate rather reach read ready real reality realize really
reason receive recent recently recognize record red reduce reflect region
relate relationship religious remain remember remove report represent
require research resource respond response responsibility rest result return
reveal rich right rise risk road rock role room rule run safe same save say
scene school science scientist score sea season seat second section security
see seek seem sell send senior sense series serious serve service set seven
several sex shake share she shoot short shot should shoulder show side sign
significant similar simple simply since sing single sister sit site situation
six size skill skin small smile so social society soldier some somebody
someone something sometimes son song soon sort sound source south space speak
special specific speech spend sport spring staff stage stand standard star
start state statement station stay step still stock stop store story
strategy street strong structure student study stuff style subject success
successful such suddenly suffer suggest summer support sure surface system
table take talk task tax teach teacher team technology television tell ten
tend term test than thank that the their them themselves then theory there
these they thing think third this those though thought thousand threat three
through throughout throw thus time to today together tonight too top total
tough toward town trade traditional training travel treat treatment tree
trial trip trouble true truth try turn two type under understand unit until
up upon us use usually value various very victim view violence visit voice
vote wait walk wall want war watch water way we weapon wear week weight well
west what whatever when where whether which while white who whole whom whose
why wide wife will win wind window wish with within without woman wonder word
work worker world worry would write writer wrong yard yeah year yes yet you
young your yourself
`.trim();

/* ============================================================================
 * CONFIG  (unchanged)
 * ==========================================================================*/

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function buildConfig(temperature) {
  const t = clamp(Number(temperature), 0, 2);
  return {
    temperature: t,
    minChars: t < 0.3 ? 4 : t < 0.7 ? 3 : 2,
    maxWords: t < 0.3 ? 6 : t < 0.7 ? 8 : t < 1.2 ? 12 : 20,
    minContentWords: t < 0.2 ? 2 : 1,
    enableContainer:   t >= 0.10,
    enableInThe:       t >= 0.00,
    enableOf:          t >= 0.30,
    enableQuoted:      t >= 0.20,
    enableColon:       t >= 0.20,
    enableDash:        t >= 0.20,
    enableCapitalized: t >= 0.60,
    enableAcronyms:    t >= 0.30,
    enableNounPhrase:  t >= 0.40,
    allowSingleWord:   t >= 0.80,
    scoreThreshold: t < 0.2 ? 0.75 : t < 0.5 ? 0.55 : t < 0.8 ? 0.40 : 0.25,
    domainBonus: t < 0.3 ? 0.20 : 0.10,
    uniqueness: {
      mode: t < 0.3 ? 'all-unknown' : t < 1.0 ? 'any-unknown' : 'ratio',
      minUnknownRatio: t < 1.0 ? 0.0 : 0.34,
      ignoreWords: new Set(['the','a','an','of','in','on','at','and','or','to','for'])
    }
  };
}

/* ============================================================================
 * TOKENS + CLASSIFIERS  (unchanged)
 * ==========================================================================*/

const TOKEN_RE = /([A-Za-z][A-Za-z0-9'_-]*)|(\d+(?:\.\d+)*)|([^\sA-Za-z0-9])/g;

function tokenize(text) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1]) tokens.push({ type: 'word', value: m[1], lower: m[1].toLowerCase(),
                            start: m.index, end: m.index + m[1].length });
    else if (m[2]) tokens.push({ type: 'num', value: m[2], lower: m[2],
                                 start: m.index, end: m.index + m[2].length });
    else tokens.push({ type: 'punct', value: m[3], lower: m[3],
                       start: m.index, end: m.index + m[3].length });
  }
  return tokens;
}

function isAcronym(v)        { return /^[A-Z0-9]{2,}$/.test(v); }
function isCapitalized(v)    { return /^[A-Z][a-z]/.test(v); }
function hasDigit(v)         { return /\d/.test(v); }
function isTechnicalShape(v) { return /[-_]/.test(v) || /^v\d+$/i.test(v); }

/* ============================================================================
 * UNIQUENESS  (unchanged)
 * ==========================================================================*/

function classifyWord(v, dict) {
  const n = normalizeWord(v);
  const known = dict ? dict.has(n) : false;
  const shape =
    isAcronym(v)        ? 'acronym'   :
    hasDigit(v)         ? 'digit'     :
    isTechnicalShape(v) ? 'technical' :
    isCapitalized(v)    ? 'proper'    :
                          'plain';
  return { normalized: n, known, shape };
}

function evaluateUniqueness(text, ucfg, dict) {
  const raw = text.split(/\s+/).filter(Boolean);
  const toks = raw.filter(w => {
    const n = normalizeWord(w);
    return n && !ucfg.ignoreWords.has(n);
  });

  if (toks.length === 0) {
    return { pass: false, known: [], unknown: [], ratio: 0, reason: 'empty' };
  }

  const known = [];
  const unknown = [];
  let override = false;

  for (const v of toks) {
    const c = classifyWord(v, dict);
    if (c.known) known.push(c.normalized);
    else unknown.push(c.normalized);
    if (c.shape === 'acronym' || c.shape === 'digit' ||
        c.shape === 'technical' || c.shape === 'proper') override = true;
  }

  const total = toks.length;
  const ratio = unknown.length / total;

  if (override) return { pass: true, known, unknown, ratio, reason: 'shape-override' };
  if (ucfg.mode === 'all-unknown')
    return unknown.length === total
      ? { pass: true, known, unknown, ratio, reason: 'all-unknown' }
      : { pass: false, known, unknown, ratio, reason: 'some-known' };
  if (ucfg.mode === 'any-unknown')
    return unknown.length >= 1
      ? { pass: true, known, unknown, ratio, reason: 'any-unknown' }
      : { pass: false, known, unknown, ratio, reason: 'all-known' };
  return ratio > ucfg.minUnknownRatio
    ? { pass: true, known, unknown, ratio, reason: 'ratio-ok' }
    : { pass: false, known, unknown, ratio, reason: 'ratio-low' };
}

/* ============================================================================
 * LEXICONS  (unchanged)
 * ==========================================================================*/

const INTRO_PREPS = new Set([
  'in','on','at','for','about','regarding','concerning','within','under','over',
  'through','via','using','with','by','per','from','to','into','onto','upon',
  'against','toward','towards','across','along','around','behind','below',
  'beneath','beside','between','beyond','during','except','inside','outside',
  'past','since','till','until','without','throughout','amid','among','amongst',
  'before','after','above','down','up','off','out','near','like'
]);

const CONTAINER_NOUNS = new Set([
  'part','section','area','portion','segment','region','aspect','domain',
  'field','scope','context','category','department','division','chapter',
  'clause','article','point','item','element','component','piece','bit',
  'chunk','block','unit','module','zone','sphere','realm','territory',
  'branch','wing','arm','side','end','face','front','back','top','bottom',
  'middle','center','centre','core','heart','essence','nature','character',
  'quality','property','attribute','feature','trait','characteristic',
  'mark','sign','token','symbol','indicator','signal','marker','flag','tag',
  'label','caption','title','heading','header','footer','note','remark',
  'comment','observation','mention','reference','citation','quote','excerpt',
  'passage','text','content','material','subject','topic','theme','matter',
  'issue','question','problem','concern','interest','focus','attention',
  'emphasis','stress','accent','weight','importance','significance','value',
  'worth','merit','virtue','excellence','goodness','grade','level','degree',
  'extent','measure','amount','quantity','number','count','total','sum',
  'aggregate','whole','entirety','totality','complete','full','step','stage',
  'phase','cycle','process','procedure','method','approach','technique',
  'strategy','tactic','plan','scheme','system','structure','framework',
  'pattern','model','example','instance','case','scenario','situation',
  'condition','state','status','mode','form','kind','type','sort','class',
  'family','group','set','collection','series','sequence','order','list',
  'array','table','chart','graph','map','diagram','figure'
]);

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','if','then','else','when','where','why',
  'how','what','which','who','whom','whose','this','that','these','those',
  'i','you','he','she','it','we','they','me','him','her','us','them','my',
  'your','his','its','our','their','mine','yours','hers','ours','theirs',
  'am','is','are','was','were','be','been','being','have','has','had',
  'having','do','does','did','doing','done','will','would','shall','should',
  'can','could','may','might','must','ought','need','dare','let','lets',
  'also','very','just','only','even','still','already','yet','ever','never',
  'always','often','sometimes','usually','generally','particularly',
  'especially','specifically','namely','etc','eg','ie','cf','vs',
  'here','there','now','then','once','twice','first','second','third',
  'last','next','previous','following','preceding','yes','no','not',
  'nor','none','nobody','nothing','nowhere','any','some','all','both','each',
  'every','either','neither','many','much','more','most','few','less',
  'least','several','other','another','such','same','own','different',
  'various','one','two','three','four','five','six','seven','eight','nine',
  'ten','please','kindly','maybe','perhaps','possibly','probably','certainly',
  'surely','definitely','absolutely','completely','totally','entirely',
  'fully','partly','partially','mostly','mainly','chiefly','primarily',
  'largely','widely','commonly','typically','normally','regularly',
  'frequently','rarely','seldom','hardly','barely','scarcely','almost',
  'nearly','quite','rather','fairly','pretty','really','truly','actually',
  'indeed','well','ok','okay','hi','hey','hello','goodbye','bye','yeah',
  'yep','nope','nah'
]);

const DETERMINERS = new Set([
  'a','an','the','this','that','these','those','my','your','his','her','its',
  'our','their','some','any','all','both','each','every','either','neither',
  'no','many','much','more','most','few','less','least','several','other',
  'another','such','what','which','whose','one','two','three'
]);

const COMMON_ADJECTIVES = new Set([
  'big','small','large','tiny','huge','giant','little','long','short','tall',
  'high','low','wide','narrow','thick','thin','deep','shallow','heavy',
  'light','fast','slow','quick','rapid','new','old','young','ancient',
  'modern','recent','current','future','past','good','bad','better','best',
  'worse','worst','great','excellent','poor','fine','nice','lovely',
  'beautiful','ugly','happy','sad','angry','calm','quiet','loud','noisy',
  'bright','dark','colorful','clear','cloudy','sunny','rainy','hot','cold',
  'warm','cool','freezing','boiling','dry','wet','hard','soft','smooth',
  'rough','sharp','dull','clean','dirty','fresh','stale','sweet','sour',
  'bitter','salty','spicy','strong','weak','tough','fragile','sturdy',
  'solid','liquid','main','primary','secondary','major','minor','critical',
  'important','essential','vital','crucial','key','central','core',
  'fundamental','basic','advanced','simple','complex','easy','difficult',
  'tricky','challenging','possible','impossible','likely','unlikely',
  'certain','sure','true','false','real','fake','actual','virtual','digital',
  'physical','mental','emotional','spiritual','social','public','private',
  'personal','shared','common','unique','special','rare','frequent',
  'regular','irregular','normal','abnormal','typical','atypical','standard',
  'custom','default','optional','required','mandatory','secure','insecure',
  'safe','dangerous','risky','reliable','unreliable','stable','unstable',
  'flexible','rigid','dynamic','static','active','inactive','enabled',
  'disabled','open','closed','visible','hidden','internal','external',
  'local','remote','global','regional','national','international','online',
  'offline','synchronous','asynchronous','sync','async','parallel',
  'sequential','concurrent','serial','single','multiple','identical',
  'equal','unequal','greater','lesser','higher','lower','upper','inner',
  'outer','left','right','near','far','close','distant','adjacent',
  'neighboring','surrounding','nearby','faraway'
]);

function isStop(w) { return STOP_WORDS.has(w); }
function isCont(w) { return CONTAINER_NOUNS.has(w); }
function isPrep(w) { return INTRO_PREPS.has(w); }
function isDet(w)  { return DETERMINERS.has(w); }
function isAdj(w)  { return COMMON_ADJECTIVES.has(w); }
function isBoundaryToken(tk) {
  if (tk.type === 'punct' || tk.type === 'num') return true;
  const w = tk.lower;
  return isStop(w) || isPrep(w);
}

/* ============================================================================
 * CANDIDATE COLLECTORS  (unchanged)
 * ==========================================================================*/

function joinTokens(tokens, start, end) {
  return tokens.slice(start, end).map(t => t.value).join(' ');
}

function forwardRun(tokens, i, cfg) {
  let end = i;
  while (end < tokens.length && end - i < cfg.maxWords) {
    const tk = tokens[end];
    if (tk.type !== 'word') break;
    if (isBoundaryToken(tk)) break;
    end++;
  }
  return { start: i, end };
}

function collectContainer(tokens, cfg, push) {
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (t.type !== 'word' || !isPrep(t.lower)) continue;
    if (!(tokens[i+1] && tokens[i+1].type === 'word' && tokens[i+1].lower === 'the')) continue;
    const c = tokens[i+2];
    if (!(c && c.type === 'word' && isCont(c.lower))) continue;

    const ofTk = tokens[i+3];
    if (ofTk && ofTk.type === 'word' && ofTk.lower === 'of') {
      const run = forwardRun(tokens, i + 4, cfg);
      if (run.end > run.start) {
        push({ text: joinTokens(tokens, run.start, run.end), pattern: 'container' });
      }
    }
    const run = forwardRun(tokens, i + 2, cfg);
    if (run.end - run.start >= 2) {
      push({ text: joinTokens(tokens, run.start, run.end), pattern: 'container' });
    }
  }
}

function collectInThe(tokens, cfg, push) {
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.type !== 'word' || !isPrep(t.lower)) continue;
    if (!(tokens[i+1] && tokens[i+1].type === 'word' && tokens[i+1].lower === 'the')) continue;
    const run = forwardRun(tokens, i + 2, cfg);
    if (run.end > run.start) {
      push({ text: joinTokens(tokens, run.start, run.end), pattern: 'in-the-X' });
    }
  }
}

function collectOf(tokens, cfg, push) {
  for (let i = 1; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.type !== 'word' || t.lower !== 'of') continue;
    const right = forwardRun(tokens, i + 1, cfg);
    if (right.end > right.start) {
      push({ text: joinTokens(tokens, right.start, right.end), pattern: 'X-of-Y' });
    }
    let ls = i - 1;
    while (ls >= 0) {
      const tk = tokens[ls];
      if (tk.type !== 'word') { ls++; break; }
      if (isPrep(tk.lower) || tk.lower === 'the') { ls++; break; }
      ls--;
    }
    if (ls < 0) ls = 0;
    if (ls < i) push({ text: joinTokens(tokens, ls, i), pattern: 'X-of-Y' });
  }
}

function collectQuoted(text, cfg, push) {
  for (const re of [
    /["'`]([^"'`\n]{2,140})["'`]/g,
    /[\(\[]([^\)\]\n]{2,140})[\)\]]/g
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) push({ text: m[1], pattern: 'quoted' });
  }
}

function collectAfterPunct(text, re, pattern, push) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) push({ text: m[1], pattern });
}

function collectCapitalized(text, cfg, push) {
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4}|[A-Z]{2,}(?:\s+[A-Z]{2,}){0,3})\b/g;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const phrase = m[1];
    const isSentenceStart =
      m.index === 0 || /[.!?]\s+$/.test(text.slice(Math.max(0, m.index - 5), m.index));
    if (isSentenceStart && !/\s/.test(phrase)) continue;
    push({ text: phrase, pattern: 'capitalized' });
  }
}

function collectAcronyms(text, cfg, push) {
  const re = /\b([A-Z]{2,}(?:[-_][A-Z0-9]+)*)\b/g;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) push({ text: m[1], pattern: 'acronym' });
}

function collectNounPhrases(tokens, cfg, push) {
  let i = 0;
  while (i < tokens.length) {
    const tk = tokens[i];
    if (tk.type !== 'word' || isPrep(tk.lower)) { i++; continue; }
    const start = i;
    if (isDet(tk.lower)) {
      i++;
      if (i >= tokens.length || tokens[i].type !== 'word') { i = start + 1; continue; }
    }
    let adjCount = 0;
    while (i < tokens.length && tokens[i].type === 'word' && isAdj(tokens[i].lower) && adjCount < 3) {
      i++; adjCount++;
    }
    let nounCount = 0;
    while (i < tokens.length && tokens[i].type === 'word') {
      const w = tokens[i].lower;
      if (isStop(w) || isPrep(w) || isAdj(w)) break;
      if (tokens[i].value.length < 3 && nounCount === 0 && !isAcronym(tokens[i].value)) break;
      nounCount++; i++;
      if (nounCount >= 4) break;
    }
    if (nounCount >= 1 && i > start) {
      push({ text: joinTokens(tokens, start, i), pattern: 'noun-phrase' });
    }
    if (i === start) i++;
  }
}

function collectCandidates(tokens, text, cfg) {
  const out = [];
  const push = (c) => { if (c && c.text && c.text.trim()) out.push(c); };

  if (cfg.enableContainer)   collectContainer(tokens, cfg, push);
  if (cfg.enableInThe)       collectInThe(tokens, cfg, push);
  if (cfg.enableOf)          collectOf(tokens, cfg, push);
  if (cfg.enableQuoted)      collectQuoted(text, cfg, push);
  if (cfg.enableColon)       collectAfterPunct(text, /[:：]\s*([^.;!?\n]{2,140})/g, 'after-colon', push);
  if (cfg.enableDash)        collectAfterPunct(text, /[—–-]\s+([^.;!?\n]{2,140})/g, 'after-dash', push);
  if (cfg.enableCapitalized) collectCapitalized(text, cfg, push);
  if (cfg.enableAcronyms)    collectAcronyms(text, cfg, push);
  if (cfg.enableNounPhrase)  collectNounPhrases(tokens, cfg, push);

  return out;
}

/* ============================================================================
 * SCORING  (unchanged)
 * ==========================================================================*/

function cleanCandidate(text) {
  if (!text) return '';
  return text.trim()
    .replace(/^[\s"'`(\[\{<]+/, '')
    .replace(/[\s"'`)\]\}>]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

const PATTERN_BONUS = {
  'container': 0.20, 'in-the-X': 0.15, 'X-of-Y': 0.10,
  'quoted': 0.20, 'after-colon': 0.15, 'after-dash': 0.10,
  'capitalized': 0.05, 'acronym': 0.05, 'noun-phrase': 0.00
};

function scoreCandidate(candidate, cfg, pattern, uniq) {
  const cleaned = cleanCandidate(candidate);
  if (!cleaned) return 0;
  const words = cleaned.split(/\s+/);
  const lowers = words.map(w => w.toLowerCase().replace(/[^a-z0-9'-]/g, ''));

  if (cleaned.length < cfg.minChars) return 0;
  if (words.length > cfg.maxWords) return 0;

  const contentCount = lowers.filter(w => w && !isStop(w)).length;
  if (contentCount < cfg.minContentWords) return 0;
  if (/^[0-9\s.]+$/.test(cleaned)) return 0;

  let score = 0.40;
  if (lowers.some(isCont)) score += 0.15;
  if (lowers.some(w => !isStop(w) && !isAdj(w) && w.length >= 4)) score += cfg.domainBonus;
  if (words.length >= 2 && words.length <= 5) score += 0.10;
  if (words.length >= 3 && words.length <= 4) score += 0.05;
  if (words.some(w => /^[A-Z]/.test(w))) score += 0.10;
  if (words.some(w => /^[A-Z]{2,}$/.test(w))) score += 0.15;
  const adjCount = lowers.filter(isAdj).length;
  if (adjCount > 0 && adjCount === contentCount) score -= 0.25;
  if (words.length === 1 && lowers[0].length <= 3) score -= 0.20;
  score += PATTERN_BONUS[pattern] || 0;

  if (uniq) {
    score += Math.min(uniq.unknown.length * 0.05, 0.25);
    if (uniq.reason === 'shape-override') score += 0.10;
  }
  return Math.min(score, 1.5);
}

/* ============================================================================
 * EXTRACTION  (unchanged algorithm)
 * ==========================================================================*/

export function extractPointments(text, opts = {}) {
  const src = typeof text === 'string' ? text : String(text ?? '');
  const temperature = opts.temperature != null ? Number(opts.temperature) : 0.5;
  const cfg = buildConfig(temperature);
  const onlyUnique = opts.onlyUnique !== false;

  // *** The dictionary MUST be passed. No silent fallback. ***
  const dict = opts.dictionary;
  if (!dict) throw new Error('extractPointments: options.dictionary is required');

  const tokens = tokenize(src);
  const candidates = collectCandidates(tokens, src, cfg);

  const accepted = new Map();

  for (const c of candidates) {
    const cleaned = cleanCandidate(c.text);
    if (!cleaned) continue;
    if (cleaned.toLowerCase() === src.trim().toLowerCase()) continue;

    const uniq = evaluateUniqueness(cleaned, cfg.uniqueness, dict);
    if (onlyUnique && !uniq.pass) continue;

    const score = scoreCandidate(cleaned, cfg, c.pattern, uniq);
    if (score < cfg.scoreThreshold) continue;

    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount === 1 && !cfg.allowSingleWord && cfg.temperature < 0.8) {
      const v = cleaned;
      const allowed =
        isAcronym(v) || /^[A-Z][a-z]+$/.test(v) || hasDigit(v) || isTechnicalShape(v);
      if (!allowed) continue;
    }

    const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;

    const prev = accepted.get(key);
    if (!prev || prev.score < score) {
      accepted.set(key, {
        text: cleaned, score, pattern: c.pattern,
        known: uniq.known, unknown: uniq.unknown,
        ratio: uniq.ratio, reason: uniq.reason
      });
    }
  }

  const results = Array.from(accepted.values())
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));

  if (!opts.withMeta) return results.map(r => r.text);

  return {
    input: src,
    temperature: cfg.temperature,
    dictionary: { name: dict.name, size: dict.size(), sources: dict.sources },
    pointments: results.map(r => r.text),
    details: results.map(r => ({
      text: r.text,
      score: Number(r.score.toFixed(3)),
      pattern: r.pattern,
      known: r.known,
      unknown: r.unknown,
      unknownRatio: Number(r.ratio.toFixed(3)),
      reason: r.reason
    })),
    stats: { candidates: candidates.length, accepted: results.length }
  };
}

/* ============================================================================
 * HTTP SERVER  (unchanged shape, adapted to instance)
 * ==========================================================================*/

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > limit) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function buildServer(dict) {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    const parsed = url.parse(req.url, true);

    // POST /extract
    if (parsed.pathname === '/extract' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const data = body ? JSON.parse(body) : {};
        const text = data.text ?? data.prompt ?? '';
        const temperature = data.temperature != null ? Number(data.temperature) : 0.5;
        const withMeta = !!data.withMeta;
        const onlyUnique = data.onlyUnique !== false;

        const result = extractPointments(text, {
          temperature, withMeta, onlyUnique, dictionary: dict
        });

        return sendJSON(res, 200, {
          success: true,
          input: text,
          temperature,
          ...(withMeta ? { result } : { pointments: result, count: result.length })
        });
      } catch (err) {
        return sendJSON(res, 400, { success: false, error: err.message });
      }
    }

    // GET /extract
    if (parsed.pathname === '/extract' && req.method === 'GET') {
      const text = parsed.query.text || parsed.query.prompt || '';
      const temperature = parsed.query.temperature != null ? Number(parsed.query.temperature) : 0.5;
      const withMeta = parsed.query.withMeta === '1' || parsed.query.withMeta === 'true';
      const onlyUnique = parsed.query.onlyUnique !== '0' && parsed.query.onlyUnique !== 'false';

      const result = extractPointments(text, {
        temperature, withMeta, onlyUnique, dictionary: dict
      });

      return sendJSON(res, 200, {
        success: true,
        input: text,
        temperature,
        ...(withMeta ? { result } : { pointments: result, count: result.length })
      });
    }

    // GET /dictionary/stats
    if (parsed.pathname === '/dictionary/stats' && req.method === 'GET') {
      return sendJSON(res, 200, {
        success: true,
        name: dict.name,
        size: dict.size(),
        sources: dict.sources
      });
    }

    // GET /dictionary/check?word=foo
    if (parsed.pathname === '/dictionary/check' && req.method === 'GET') {
      const word = parsed.query.word || '';
      const n = normalizeWord(word);
      return sendJSON(res, 200, {
        success: true,
        word,
        normalized: n,
        known: dict.has(n),
        dictionarySize: dict.size()
      });
    }

    // POST /dictionary (replace the server dictionary)
    if (parsed.pathname === '/dictionary' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const data = body ? JSON.parse(body) : {};
        const newDict = new Dictionary(data.name || 'uploaded');

        if (data.includeEnglishBase !== false) {
          newDict.addMany(ENGLISH_BASE_WORDS.split(/\s+/));
          newDict.sources.push({
            source: 'english-base',
            added: newDict.size(),
            total: newDict.size()
          });
        }
        if (data.json !== undefined) newDict.addJSON(data.json, data.name || 'uploaded');

        // mutate the shared dict in place
        dict.name = newDict.name;
        dict.words = newDict.words;
        dict.sources = newDict.sources;

        return sendJSON(res, 200, {
          success: true,
          dictionary: { name: dict.name, size: dict.size(), sources: dict.sources }
        });
      } catch (err) {
        return sendJSON(res, 400, { success: false, error: err.message });
      }
    }

    // GET /
    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML_UI);
    }

    sendJSON(res, 404, { success: false, error: 'Not found. Use /extract' });
  });
}

const HTML_UI = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pointment Extractor</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:20px;color:#222}
 textarea{width:100%;height:130px;padding:10px;font:14px ui-monospace,monospace;box-sizing:border-box}
 textarea.dict{height:140px;background:#fafafa}
 .row{display:flex;gap:16px;align-items:center;margin:10px 0;flex-wrap:wrap}
 button{padding:8px 16px;font-size:15px;cursor:pointer}
 input[type=range]{flex:1;min-width:200px}
 .chip{display:inline-block;background:#e3f2fd;padding:4px 10px;margin:3px;border-radius:12px;font-size:14px}
 .chip.hot{background:#ffcdd2}.chip.proper{background:#c8e6c9}.chip.acronym{background:#d1c4e9}
 pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto;font-size:12px}
 .temp{font-weight:600;min-width:60px;text-align:right}
 fieldset{border:1px solid #ddd;border-radius:6px;padding:10px;margin:10px 0}
 legend{font-weight:600;padding:0 6px}
</style></head>
<body>
<h1>Pointment Extractor</h1>
<p>Extracts unique pointments. Words in the dictionary are treated as "known" and filtered out.</p>

<fieldset><legend>Dictionary JSON (replace server dict)</legend>
<textarea id="dict" class="dict" placeholder='{"userService":"manages users","auth":{"loginEndpoint":"/api/login","tokens":["jwt","refresh"]}}'></textarea>
<div class="row">
  <label><input type="checkbox" id="engBase" checked> include english base</label>
  <button id="loadDict">Load dictionary</button>
  <button id="dictStats">Stats</button>
  <span id="dictInfo"></span>
</div>
<div class="row">
  <input id="checkWord" placeholder="check if word is known..." style="flex:1;padding:6px">
  <button id="doCheck">Check word</button>
  <span id="checkInfo"></span>
</div>
</fieldset>

<fieldset><legend>Input text</legend>
<textarea id="input">In the part of userService, do Y.
In the authentication module, validate tokens with SHA256.
The database of users must sync with Redis before deploy.
Note: run "schema-sync" after the Kafka consumer is up.</textarea>
</fieldset>

<div class="row">
  <label>Temperature:</label>
  <input type="range" id="temp" min="0" max="1.5" step="0.05" value="0.5">
  <span class="temp" id="tempVal">0.50</span>
</div>
<div class="row">
  <label><input type="checkbox" id="unique" checked> only unique</label>
  <label><input type="checkbox" id="meta" checked> details</label>
  <button id="go">Extract</button>
</div>
<div id="out"></div>

<script>
 const $=s=>document.querySelector(s);
 $('#temp').addEventListener('input',e=>{$('#tempVal').textContent=Number(e.target.value).toFixed(2);});

 $('#loadDict').addEventListener('click',async()=>{
   const raw=$('#dict').value.trim();
   if(!raw){$('#dictInfo').textContent='no json';return;}
   let json;try{json=JSON.parse(raw);}catch(e){$('#dictInfo').textContent='invalid json';return;}
   const r=await fetch('/dictionary',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({json,includeEnglishBase:$('#engBase').checked})});
   const d=await r.json();
   $('#dictInfo').textContent = d.success
     ? 'loaded ('+d.dictionary.size+' words)'
     : 'error: '+d.error;
 });
 $('#dictStats').addEventListener('click',async()=>{
   const r=await fetch('/dictionary/stats');const d=await r.json();
   $('#dictInfo').textContent='size='+d.size+' name='+d.name;
 });
 $('#doCheck').addEventListener('click',async()=>{
   const w=$('#checkWord').value.trim();
   if(!w) return;
   const r=await fetch('/dictionary/check?word='+encodeURIComponent(w));
   const d=await r.json();
   $('#checkInfo').textContent = d.known
     ? '"'+d.normalized+'" IS KNOWN (size='+d.dictionarySize+')'
     : '"'+d.normalized+'" is UNKNOWN';
 });
 $('#go').addEventListener('click',async()=>{
   const body={text:$('#input').value,temperature:Number($('#temp').value),
     withMeta:$('#meta').checked,onlyUnique:$('#unique').checked};
   const r=await fetch('/extract',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(body)});
   const d=await r.json();
   const out=$('#out');
   if(!d.success){out.innerHTML='<pre>'+JSON.stringify(d,null,2)+'</pre>';return;}
   const list = d.result ? d.result.pointments : d.pointments;
   const det  = d.result ? d.result.details : [];
   if(!list.length){out.innerHTML='<p><em>No unique pointments.</em></p>';return;}
   let html='<h2>'+list.length+' pointment(s)</h2>';
   det.forEach(x=>{
     let cls='chip';
     if(x.reason==='shape-override') cls+=' proper';
     else if(x.score>=0.9) cls+=' hot';
     html+='<span class="'+cls+'" title="score='+x.score+' pattern='+x.pattern+
       ' unknown=['+x.unknown.join(',')+']">'
       +x.text.replace(/</g,'&lt;')+'</span>';
   });
   if(!det.length){html+=list.map(p=>'<span class="chip">'+p.replace(/</g,'&lt;')+'</span>').join('');}
   html+='<h3>Raw</h3><pre>'+JSON.stringify(d,null,2).replace(/</g,'&lt;')+'</pre>';
   out.innerHTML=html;
 });
</script></body></html>`;

/* ============================================================================
 * INSTANCED API
 * ==========================================================================*/

export class PointmentExtractor {
  /**
   * @param {object} [opts]
   * @param {number} [opts.temperature=0.5]
   * @param {string} [opts.name='custom']
   * @param {boolean} [opts.loadEnglishBase=false] if true, awaits the base immediately (only if awaited in factory)
   */
  constructor(opts = {}) {
    this.dictionary = new Dictionary(opts.name || 'custom');
    this.temperature = opts.temperature != null ? Number(opts.temperature) : 0.5;
    this.ready = false;
    this._loading = null;
    this._server = null;
  }

  /** Await-able factory that also loads the english base. */
  static async create(opts = {}) {
    const px = new PointmentExtractor(opts);
    await px.loadEnglishBase();
    return px;
  }

  /** Load the built-in english word list. */
  async loadEnglishBase() {
    this.dictionary.addMany(ENGLISH_BASE_WORDS.split(/\s+/));
    // record source exactly like the original main()
    const added = this.dictionary.size();
    this.dictionary.sources.push({
      source: 'english-base',
      added,
      total: this.dictionary.size()
    });
    this.ready = true;
    return added;
  }

  /**
   * Async JSON file load. Returns number of new words.
   * Guards concurrent loads via a shared promise.
   */
  loadJSON(filePath, source) {
    if (this._loading) {
      return this._loading.then(() => this.loadJSON(filePath, source));
    }
    this._loading = (async () => {
      const added = await this.dictionary.loadFileAsync(filePath);
      if (source) {
        const last = this.dictionary.sources[this.dictionary.sources.length - 1];
        if (last) last.source = source;
      }
      this.ready = true;
      this._loading = null;
      return added;
    })().catch((e) => {
      this._loading = null;
      throw e;
    });
    return this._loading;
  }

  /** Async in-memory JSON object load. */
  async loadJSONObject(obj, source = 'object') {
    const added = this.dictionary.addJSON(obj, source);
    this.ready = true;
    return added;
  }

  /** True once at least one load (base or JSON) has completed. */
  isReady() {
    return this.ready === true;
  }

  /** Throws if not ready — used internally and by consumers. */
  ensureReady() {
    if (!this.isReady()) {
      throw new Error(
        'PointmentExtractor is not ready. Call await loadEnglishBase() and/or await loadJSON(...) first.'
      );
    }
    return true;
  }

  /** Await this if you just want to block until any in-flight load resolves. */
  async waitReady() {
    if (this._loading) await this._loading;
    return this.isReady();
  }

  setTemperature(t) {
    this.temperature = Number(t);
    return this;
  }

  /** Extract using this instance's dictionary + temperature. */
  extract(text, opts = {}) {
    this.ensureReady();
    const temperature = opts.temperature != null
      ? Number(opts.temperature)
      : this.temperature;
    return extractPointments(text, {
      ...opts,
      temperature,
      dictionary: this.dictionary
    });
  }

  /** Dictionary helpers */
  hasWord(w)       { return this.dictionary.has(w); }
  dictionarySize() { return this.dictionary.size(); }
  dictionaryStats() {
    return {
      name: this.dictionary.name,
      size: this.dictionary.size(),
      sources: this.dictionary.sources
    };
  }

  /** Start the HTTP server bound to this instance's dictionary. */
  listen(port = 3000, cb) {
    this.ensureReady();
    if (this._server) return this._server;
    this._server = buildServer(this.dictionary);
    this._server.listen(port, cb);
    return this._server;
  }

  async close() {
    if (!this._server) return;
    await new Promise((resolve) => this._server.close(resolve));
    this._server = null;
  }
}

export { buildServer, ENGLISH_BASE_WORDS };
export default PointmentExtractor;

/* ============================================================================
 * MAIN  (CLI entrypoint, preserved)
 * ==========================================================================*/

async function main() {
  const args = process.argv.slice(2);

  const px = new PointmentExtractor({ name: 'custom', temperature: 0.5 });
  await px.loadEnglishBase();

  for (const arg of args) {
    try {
      const before = px.dictionarySize();
      await px.loadJSON(arg);
      const added = px.dictionarySize() - before;
      const last = px.dictionary.sources[px.dictionary.sources.length - 1];
      console.error(`✓ loaded ${last ? last.source : arg}  (+${added} words, total ${px.dictionarySize()})`);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  }

  const PORT = Number(process.env.PORT) || 3000;
  px.listen(PORT, () => {
    console.log(`Pointment Extractor running on http://localhost:${PORT}`);
    console.log(`Dictionary: ${px.dictionarySize()} words`);
    for (const s of px.dictionary.sources) {
      console.log(`  - ${s.source}: +${s.added}`);
    }
    console.log('');
    console.log('  POST /extract              { "text":"...", "temperature":0.5 }');
    console.log('  GET  /extract?text=...&temperature=0.5');
    console.log('  GET  /dictionary/stats');
    console.log('  GET  /dictionary/check?word=foo');
    console.log('  POST /dictionary           { "json": {...} }');
  });
}

// Run only when this file is the entrypoint.
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
