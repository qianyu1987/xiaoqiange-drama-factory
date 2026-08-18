const SERIES = {
  slug: 'primordial-chinese-myth',
  title: '混沌初开：中国神话纪',
  genre: '原创中国神话家庭动画',
  style: '东方电影级3D家庭动画，青铜、玉石、云海、上古山川与克制的神性光辉，人物比例稳定，非写实宗教造像',
  description: '从混沌初开与盘古开天出发，融合早期创世记载、《封神演义》人物体系和民间神话的原创改编。',
  sources: [
    { subject: '盘古', source: '徐整《三五历纪》与《五运历年纪》的后世辑录', treatment: '采用混沌、开天与身化万物母题' },
    { subject: '鸿钧', source: '《封神演义》及后世民间、洪荒叙事体系', treatment: '作为融合世界观角色，不宣称属于早期盘古文献' },
    { subject: '整体时间线', source: '多源神话融合', treatment: '原创家庭动画改编，并在片尾明确标注' },
  ],
};

const { NOVEL_EPISODES } = require('./chineseMythNovel');
const EPISODES = NOVEL_EPISODES.map(({ episodeNumber, title, description, scriptContent }) => ({
  episodeNumber,
  title,
  description,
  scriptContent,
}));

const CORE_CHARACTERS = [
  ['盘古', '创世者', '高大宽肩的成年男性神祇，方正沉稳的面部轮廓，浓黑长发束于脑后，青铜与深岩色护肩，腰间粗麻与兽纹织物，双手持无文字的古朴开天巨斧；力量巨大但神情克制。'],
  ['鸿钧', '秩序观察者', '清瘦高挑的年长男性神祇，银白长发和短须，眉目平静，灰白与淡紫层叠长袍，玉质发簪，周身仅有细微紫气，不使用夸张王冠。'],
  ['女娲', '生命创造者', '端庄而有行动力的成年女性神祇，温暖棕黑长发，青玉与赭红衣裙，肩臂有简洁蛇纹织饰，携带五色石与陶土工具，神情坚定而亲切。'],
  ['伏羲', '文明观察者', '沉静敏锐的成年男性神祇，深棕长发半束，青灰织衣与皮革腰封，随身携带无文字木制观测板和弦纹古琴，手势清晰克制。'],
  ['太清', '转化与平衡', '三清中的年长男性，白发白须、清瘦慈和，素白与淡青道袍，无现代符号，持朴素拂尘与青铜丹炉配件。'],
  ['玉清', '规则与秩序', '三清中的中年男性，黑发高束、面容端正严谨，象牙白与深蓝层叠长袍，玉冠简洁，持无文字玉简。'],
  ['上清', '自由与包容', '三清中的年轻成年男性，深黑长发自然束起，墨青与暗红衣袍，神情锐利但不邪异，背负朴素长剑。'],
  ['后土', '大地与轮回', '沉稳温柔的成年女性神祇，深褐长发编成宽辫，赭石、苔绿和土金色衣裙，佩戴石质圆环，双足与大地保持强烈联系。'],
  ['共工', '水之力量', '魁梧成年男性神祇，深蓝黑长发，青铜护臂与深蓝鳞纹战衣，水流形成披肩轮廓，愤怒时仍保持人形和清晰五官。'],
  ['祝融', '火之守护', '精悍成年男性神祇，暗红短束发，赤铜护甲与黑红织衣，肩后有克制火光，手持无文字火种杖，表情直接而有责任感。'],
].map(([name, role, appearance], index) => ({ name, role, appearance, sortOrder: index + 1 }));

const BGM_MOTIF = '96 BPM cinematic Chinese myth motif, low frame drums, xun flute, restrained bronze bells and deep strings, heroic but solemn, no vocals, same melody and instrumentation across all eight clips';

const PILOT_STORYBOARDS = [
  {
    title: '混沌发出心跳', speaker: '', spokenText: '', offscreenVoice: '天地还没有名字，黑暗里先响起一声心跳。',
    action: '0-2秒黑暗中出现一圈微弱金色脉冲；2-5秒混沌云团向内收缩；5-8秒岩壳般的巨大轮廓睁开双眼；8-10秒低机位迅速推近盘古。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, endless dark chaos clouds folding inward around a colossal sleeping male creator silhouette, one subtle warm pulse, bronze and jade color accents, readable face emerging from darkness, no text.',
    sound: 'deep primordial heartbeat, compressed wind, distant stone resonance', references: ['盘古'],
  },
  {
    title: '盘古苏醒', speaker: '盘古', spokenText: '这黑暗压了太久，今日该醒了。', offscreenVoice: '',
    action: '0-2秒盘古猛然撑地起身；2-5秒碎岩从肩部滑落；5-8秒他说话并握紧斧柄；8-10秒周围混沌被气浪推开。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, Pangu rising powerfully inside compressed chaos, broad shoulders, tied black hair, bronze and dark stone armor, ancient unmarked axe beside him, fast debris and volumetric wind, no text.',
    sound: 'stone cracking, heavy breath, low wind pressure', references: ['盘古'],
  },
  {
    title: '寻找出口', speaker: '盘古', spokenText: '若天地没有出口，我便亲手劈开。', offscreenVoice: '',
    action: '0-2秒盘古环视无边黑暗；2-4秒手掌触到无形边界；4-7秒边界反弹出金色裂纹；7-10秒盘古抬斧转身蓄力。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, Pangu touches an invisible curved boundary in chaos, golden stress cracks spread from his palm, then he pivots and raises an ancient axe, dynamic three-quarter camera, no text.',
    sound: 'hollow boundary vibration, bronze grip creak, rising wind', references: ['盘古'],
  },
  {
    title: '第一斧', speaker: '盘古', spokenText: '混沌，退开！', offscreenVoice: '',
    action: '0-2秒斧刃从画外高速进入；2-5秒盘古完整挥斧并喊出短句；5-7秒白金裂缝贯穿混沌；7-10秒镜头随冲击波高速后拉。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, Pangu completes one decisive axe swing, a white-gold fissure cuts through black chaos, powerful readable body mechanics, fast camera pullback, restrained energy, no text.',
    sound: 'single massive axe arc, thunderous split, rushing pressure wave', references: ['盘古'],
  },
  {
    title: '清浊分离', speaker: '', spokenText: '', offscreenVoice: '',
    action: '0-2秒裂缝爆发但无黑场；2-5秒清气旋转上升成天；5-8秒浊气翻滚下沉成地；8-10秒盘古落在两者之间用肩背撑住。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, white-gold opening separates luminous rising sky vapor from heavy descending earth matter, Pangu lands between both layers and braces them apart, grand scale, no text.',
    sound: 'expanding air, falling earth rumble, strained stone and leather', references: ['盘古'],
  },
  {
    title: '一丈又一丈', speaker: '盘古', spokenText: '天再高一丈，我便再长一丈。', offscreenVoice: '',
    action: '0-2秒天空快速上升；2-5秒盘古双臂上举并说话；5-8秒身体随天地距离增长；8-10秒新生山脊从脚边向远方铺开。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, Pangu holds the rising sky with both arms while his scale grows, newborn mountain ridges unfold rapidly from his feet, strong silhouette, warm dawn entering, no text.',
    sound: 'rising wind, deep body strain, mountain ridges forming', references: ['盘古'],
  },
  {
    title: '身化山河', speaker: '', spokenText: '', offscreenVoice: '',
    action: '0-2秒盘古疲惫但平静地放下手臂；2-5秒呼吸化为长风；5-8秒血脉化为奔流河川；8-10秒发丝化为森林越过镜头。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, Pangu peacefully transforms into the natural world, breath becoming wind, glowing veins becoming rivers, hair becoming vast forests, dignified and non-graphic, no text.',
    sound: 'soft final breath, growing river, forest leaves sweeping past camera', references: ['盘古'],
  },
  {
    title: '紫气中的来客', speaker: '', spokenText: '', offscreenVoice: '山河有了形状，新的守护者也在紫气中睁开了眼。',
    action: '0-2秒镜头掠过完整新世界；2-5秒云海深处出现一缕紫气；5-8秒鸿钧背影在远峰睁眼但保持闭口；8-10秒紫气汇成通往下一集的光路。',
    imagePrompt: 'Cinematic 3D Chinese primordial myth, widescreen 16:9, sweeping view of the newborn mountains and rivers, a restrained violet mist gathers on a distant peak around the silent back silhouette of Hongjun, elegant sequel hook, no text.',
    sound: 'wide mountain wind, distant bronze bell, subtle violet energy resonance', references: ['鸿钧'],
  },
].map((shot, index) => ({ ...shot, storyboardNumber: index + 1, duration: 10, bgmMotif: BGM_MOTIF }));

module.exports = { SERIES, EPISODES, CORE_CHARACTERS, PILOT_STORYBOARDS, BGM_MOTIF };
