import {SONG_MAX_SCORE,scoreAnswer,performanceBadgeTotals} from '../../../packages/game-core/src';
import {tutorialScoreSlides} from './tutorial-model';
import {PerformanceBadge} from './PerformanceBadge';

export function TutorialScoreRules({page}:{page:number}){
 return <section className="tutorial-score-rules" aria-label="计分规则" data-score-page={page}>
  <h2>{tutorialScoreSlides[page]!.title}</h2>
  {page===0&&<><dl className="tutorial-score-maximums">{Object.entries(SONG_MAX_SCORE).map(([level,score])=><div key={level}><dt>{level.toUpperCase()}</dt><dd>{score} 分</dd></div>)}</dl><p>题目应得满分按开局难度保留，使用提示不会降低这个结算基准。</p></>}
  {page===1&&<><p>前 1/6 限时保留全部时间分，之后随耗时线性扣分，最多扣计分上限的 50%。</p><p>AT 固定 30 秒，前 5 秒不扣时间分。</p></>}
  {page===2&&<><p>每次答错扣计分上限的 10%，最多扣 50%。</p><p>超时、跳过或未猜出，单首得分为 0。</p></>}
  {page===3&&<><p>单首得分 = 计分上限 ×（1 − 时间扣分比例 − 答错扣分比例），最后四舍五入。</p><p>未降档的 HD 限时 30 秒，17.5 秒答对且答错过 1 次：1000 ×（1 − 25% − 10%）= {scoreAnswer('hd',17500,30000,1)} 分。</p></>}
  {page===4&&<><p>前两条提示不降低计分上限。第 3 条“得分减少，难度下降”会降低题图一档，计分上限改为原满分的 85%。</p><p>AT 使用后按 3000 × 85% = 2550 分计算耗时与错答扣分；题目应得满分仍为 3000 分，结算仍按 AT 的上限计算。</p></>}
  {page===5&&<><p>得分率 = 答对曲目的总分 ÷ 这些曲目在开局难度下的应得满分。降档不降低分母，未猜出曲目不计入分母。</p><p>答对 2 首 HD、共得 1900 分：1900 ÷ 2000 = 95%。</p><div className="tutorial-score-badges"><figure><PerformanceBadge grade={performanceBadgeTotals(1900,2,'hd').grade} correct={2}/><figcaption>金牌 · 数字 2 表示答对 2 首</figcaption></figure></div></>}
  {page===6&&<><div className="tutorial-score-badges">{(['rainbow','gold','red','blue','green'] as const).map((grade,i)=><figure key={grade}><PerformanceBadge grade={grade} correct={2}/><figcaption>{['100% 彩','≥95% 金','≥90% 红','≥80% 蓝','≥70% 绿'][i]}</figcaption></figure>)}</div><p>低于 70%，或未答对任何曲目，都没有成绩牌。</p></>}
 </section>;
}
