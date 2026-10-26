import {timeoutHealthCost,type Difficulty} from '../../../packages/contracts/src';
export const TUTORIAL_VERSION='phiguess-tutorial-v2';
export const TUTORIAL_HEALTH_CAPACITY=20;
export const TUTORIAL_START_HEALTH=12;
export const TUTORIAL_WRONG_ANSWER_REBUKE='我叫你输入错误答案你燕京侠吗？';
export const TUTORIAL_SCORE_FAST_FADE_MS=150;
export const TUTORIAL_SCORE_REDUCED_FADE_MS=80;
export const tutorialDamageSteps:readonly number[]=[4,6,8,9,10];
const difficultyLevels:Difficulty[]=['ez','hd','in','at'];
export function tutorialImageDifficulty(difficulty:Difficulty,hintCount:number):Difficulty {
 const index=difficultyLevels.indexOf(difficulty);return hintCount>=3&&index>0?difficultyLevels[index-1]!:difficulty;
}
export const tutorialSteps=[
 ['选择 HD','点击 HD，进入挑战设置。'],
 ['确认挑战设置','选择 5 题、30 秒、20HP，然后确认并开始。'],
 ['查看大图','点击曲绘放大，再关闭。正式挑战中，放大不会暂停计时。'],
 ['使用提示','点击提示：依次提供章节范围、身份线索，第 3 条显示“得分减少，难度下降”，降低题图和计分上限。'],
 ['试一次错误答案','输入「试试看」并提交。每次答错扣 1HP。'],
 ['答对与回血','输入 Desultory Signals 并提交，观察原图揭晓。\n无提示回 5HP，用过 1／2／3 条提示回 3／2／1HP。'],
 ['二次确认跳过','点击 TIME LEFT，再点击 SKIP? 跳过。Esc 可撤销。'],
 ['认识粉区','所有的粉区都是噪域即将生成的预警，不扣血，也不屏蔽你的点击'],
 ['粉区闪烁','教学演示延长至 2 秒，随后变成噪域。\n超时与跳过记 0 分，答错 0／1／≥2 次分别扣 5／4／3HP。'],
 ['点击红区','点击任意位置的红区，每次扣 1HP，并屏蔽原本的点击操作。\n提交按钮被红区覆盖时，按 Enter 也只扣 1HP，不提交答案。'],
 ['悬停与声音','鼠标停在噪域满 2 秒扣 1HP，声音变闷。移开后恢复声音、重新计时。'],
 ['放弃普通挑战','点击返回，再点击「放弃？」结束挑战，进入结算。'],
 ['在结算中揭晓错题','点击未猜出的抽象曲绘，查看正确曲名与原图。接下来会自动介绍计分规则。'],
 ['结算与计分规则','第三条提示降低实际计分上限，题目应得满分仍按开局难度。耗时和答错各占一半。下方说明对应正式计分规则。'],
 ['真实综合成绩牌','点击结算 NEXT 查看综合牌，再选择是否公布成绩。'],
 ['练习完成','你已经操作过正式的主要界面。随时可以从主界面重看教程。'],
] as const;
export const tutorialScoreSlides=[
 {title:'四种难度的单首满分',seconds:3},
 {title:'耗时占一半',seconds:4.5},
 {title:'答错占一半',seconds:4},
 {title:'合起来怎么算？',seconds:4.5},
 {title:'第三条提示降低计分上限',seconds:6},
 {title:'综合牌只看答对的曲目',seconds:5},
 {title:'用颜色表示综合表现',seconds:5},
] as const;
export function readTutorialDone(){try{return localStorage.getItem(TUTORIAL_VERSION)==='complete';}catch{return false;}}
export function markTutorialDone(){try{localStorage.setItem(TUTORIAL_VERSION,'complete');}catch{}}
export const timeoutDamage=timeoutHealthCost;
