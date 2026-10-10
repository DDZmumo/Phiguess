# Phigros 4.0.1 interface sounds

Copied unchanged from the user-provided local audio collection. Original source files remain intact. `manifest.json` records SHA-256 hashes and durations.

| Event | File | Phiguess use |
| --- | --- | --- |
| ui.confirm | Tap1.wav | Confirm, answer submission |
| ui.back | Tap2.wav | Return, cancel |
| ui.select | Tap3.wav | Tabs, modes, difficulty and option changes |
| ui.toggle | Tap4.wav | Changed switch and enable-sound preview |
| ui.notice | Tap5.wav | Successful account entry |
| ui.complete | Tap6.wav | Successful result publication |
| ui.start | Tap7.wav | Title screen entry |
| panel.open | panel-open.wav | Artwork zoom/reveal; source 歌曲详情打开.wav |
| panel.close | panel-close.wav | Artwork zoom close; source 歌曲详情关闭.wav |
| challenge.start | challenge-start.wav | Created challenge entry; source 课题组开始游戏音效.wav |

Tap mappings are this project's choices, not claims about the original game's button bindings. No noise-domain, damage, countdown ticks or full DS cutscene audio is connected. The original interface files play unmodified at original pitch/speed through the saved interface-sound volume and toggle.

DS selection audio is split once from the identical EZ/HD/IN/AT source: `ds-select-air.wav` = source 0–2s plus a 2s diffuse tail, `ds-transition-clean.wav` = 2–15.2s. Both have 8ms edge fades, original sample rate and playback speed. The selection tail decays into the settings screen. The confirmation segment keeps its original short cutoff; returning or leaving stops the cue. Neither loops.

`ChapterSelect0.wav` is the shared looping music for the account/game hub, leaderboard and settings tabs. It uses a separate saved music volume (default 30%); switching hub tabs retains playback position. Leaving the hub fades it out, and backgrounding the browser pauses it.

The confirmation clip keeps its visual alignment but silences the first 290ms of leftover selection reverb; the following impact and transition remain in place.

Results use EZ_LevelOver0 / HD_LevelOver1 / IN_LevelOver2 / AT_LevelOver3 respectively, looping from the start of the black-to-results reveal. The badge summary keeps the same track; leaving results fades it out. All background tracks share the saved music volume.

`game-ambience.wav` is the unchanged 第九章_里包氛围音乐.wav, looping during the guessing challenge (including inter-round reveals) through music volume. Tap5 also maps to `round.next`, once when a newly decoded later round artwork enters; initial load, restore and same-round hint changes stay silent.

`answer.correct` plays `answer-correct.wav` (演绎转场音_1.wav) once after an accepted correct answer, using effect volume. It has its own voice group so subsequent menu/next-artwork cues do not cut off its tail. Restored results and failed requests do not trigger it.

`answer.wrong` reuses the existing `challenge-start.wav` (课题组开始游戏音效.wav) once after the server accepts an incorrect answer. The same cue also plays once for a live unanswered round reaching its deadline. It does not fire for noise damage, skip, restored results or request failure.

The very quiet correct-answer source (peak 0.1214) uses an event-specific playback gain of 8, yielding a source peak below 1 before the user volume; the WAV is unchanged. Gameplay music remains active across brief per-round clock gaps. A noise hit that depletes health plays the wrong-answer cue once; ordinary noise events remain silent.

`round.skip` uses `panel-close.wav` (歌曲详情关闭.wav) after a successful confirmed skip. The initial SKIP? selection retains its short select sound.
