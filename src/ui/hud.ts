const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Thin wrapper over the static DOM in index.html. */
export class Hud {
  private cur = $('sk-cur');
  private scatter = $('sk-scatter');
  private max = document.querySelector('#swarm .max') as HTMLElement;
  private bar = $('sk-bar');
  private boss = $('boss');
  private bossBar = $('boss-bar');
  private bossPhase = $('boss-phase');
  private controls = $('controls');
  private banner = $('banner');
  private objective = $('objective');
  private marker = $('marker');
  private lesson = $('lesson');
  private lessonTitle = $('lesson-title');
  private lessonKey = $('lessonkey');
  private lessonK = $('lesson-k');
  private lessonA = $('lesson-a');
  private reminder = $('reminder');
  private reminderTimer = 0;
  private skip = $('skiptut');
  private markerD = $('marker-d');
  private objName = $('obj-name');
  private objSub = $('obj-sub');
  private skill = $('skillname');
  private outro = $('outro');
  private fade = $('fade');
  private end = $('end');
  private endTitle = $('end-title');
  private endStats = $('end-stats');
  private timer = $('timer');
  private pop = $('pop');
  private popG = $('pop-g');
  private popT = $('pop-t');
  private hits = $('hitcount');
  private coreCd = $('cd-core');
  private spiderCd = $('cd-spider');

  private bannerTimer = 0;
  private skillTimer = 0;
  private popTimer = 0;
  private hitsTimer = 0;
  private controlsFade = 1;
  private shownMax = -1;

  setSwarm(active: number, scattered: number, max: number) {
    this.cur.textContent = String(active);
    if (max !== this.shownMax) {
      this.shownMax = max;
      this.max.textContent = '/ ' + max;
    }
    this.bar.style.width = ((active / Math.max(1, max)) * 100).toFixed(1) + '%';
    // scattered shikigami are still recoverable, so they are shown as a
    // separate count rather than simply subtracted (spec 24-27)
    this.scatter.textContent = scattered > 0 ? scattered + ' SCATTERED' : '';
  }

  /** cooldowns as 0..1 remaining */
  setSkills(spread: number, gravity: number) {
    this.coreCd.style.height = (Math.max(0, Math.min(1, spread)) * 100).toFixed(0) + '%';
    this.spiderCd.style.height = (Math.max(0, Math.min(1, gravity)) * 100).toFixed(0) + '%';
  }

  setTimer(elapsed: number) {
    const m = Math.floor(elapsed / 60);
    const s = Math.floor(elapsed % 60);
    this.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }

  showBoss(show: boolean) {
    this.boss.classList.toggle('on', show);
  }

  setBoss(hp: number, max: number, phase: number) {
    this.bossBar.style.width = ((Math.max(0, hp) / max) * 100).toFixed(1) + '%';
    this.bossPhase.textContent = 'PHASE ' + phase;
  }

  /**
   * A small chevron pinned to the screen edge, pointing at the disturbance
   * while it is out of frame, with the distance under it. Hidden the moment
   * the light itself is visible -- the world does the wayfinding, this only
   * covers the gap the camera pitch creates (spec 30).
   */
  setMarker(sx: number, sy: number, distance: number, show: boolean) {
    if (!show) {
      this.controls.style.display = '';
    this.setSkillPipsVisible(true);
    this.skip.classList.remove('on');
    this.marker.classList.remove('on');
    this.lesson.classList.remove('on');
    this.lessonKey.classList.remove('on');
    this.reminder.classList.remove('on');
      return;
    }
    this.marker.classList.add('on');
    this.marker.style.left = sx.toFixed(0) + 'px';
    this.marker.style.top = sy.toFixed(0) + 'px';
    this.markerD.textContent = Math.round(distance) + 'm';
  }

  /**
   * The tutorial names one control at a time, so the permanent strip of all
   * five has to go away while it runs (spec 34).
   */
  /** show the tutorial's escape hatch, and say what to do when it is used */
  setSkipVisible(on: boolean, onSkip?: () => void) {
    this.skip.classList.toggle('on', on);
    const btn = document.getElementById('skip-btn');
    if (btn && onSkip) btn.onclick = () => onSkip();
  }

  setControlsVisible(on: boolean) {
    this.controls.style.display = on ? '' : 'none';
  }

  /** the cooldown pips name SPACE and Q before the tutorial has taught them */
  setSkillPipsVisible(on: boolean) {
    const skills = document.getElementById('skills');
    if (skills) skills.style.display = on ? '' : 'none';
  }

  /**
   * Tutorial only: the current lesson, and the single control it teaches.
   * Passing an empty title clears both (spec 17/34).
   */
  setLesson(title: string, key: string, action: string) {
    if (!title) {
      this.lesson.classList.remove('on');
      this.lessonKey.classList.remove('on');
      return;
    }
    this.lessonTitle.textContent = title;
    this.lesson.classList.add('on');
    if (key) {
      this.lessonK.textContent = key;
      this.lessonA.textContent = action;
      this.lessonKey.classList.add('on');
    } else {
      this.lessonKey.classList.remove('on');
    }
  }

  /**
   * Arena only: the whole control list, held for the first stretch of a run
   * and then faded (spec 35/36).
   */
  showReminder(seconds: number) {
    this.reminder.innerHTML =
      '<b>LMB</b> Release<br><b>RMB</b> Recall<br><b>SHIFT</b> Dash<br>' +
      '<b>SPACE</b> Spread<br><b>Q</b> Gravity';
    this.reminder.classList.add('on');
    this.reminderTimer = seconds;
  }

  /** a single nudge about one ability the player has not touched (spec 37) */
  showHint(text: string) {
    this.reminder.innerHTML = text;
    this.reminder.classList.add('on');
    this.reminderTimer = 6;
  }

  /** Kyoto only: the name of the place you are walking towards. */
  setObjective(name: string, sub: string) {
    if (!name) {
      this.marker.classList.remove('on');
    this.objective.classList.remove('on');
      return;
    }
    this.objName.textContent = name;
    this.objSub.textContent = sub;
    this.objective.classList.add('on');
  }

  /** one small centred line -- the tutorial's send-off, not a result screen */
  showOutro(text: string) {
    this.outro.textContent = text;
    this.outro.classList.add('on');
  }

  hideOutro() {
    this.outro.classList.remove('on');
  }

  /**
   * Curtain, used to hand the tutorial over to the arena without a hard cut.
   * @param to 1 = fully black, 0 = clear
   */
  setFade(to: number, seconds: number) {
    this.fade.style.transition = `opacity ${seconds}s linear`;
    this.fade.style.opacity = String(to);
  }

  /** drop the curtain instantly, e.g. before a new run paints its first frame */
  blackout() {
    this.fade.style.transition = 'none';
    this.fade.style.opacity = '1';
  }

  showBanner(text: string, seconds = 2.4) {
    this.banner.textContent = text;
    this.banner.classList.add('on');
    this.bannerTimer = seconds;
  }

  hideBanner() {
    this.banner.classList.remove('on');
    this.bannerTimer = 0;
  }

  showSkill(text: string) {
    this.skill.textContent = text;
    this.skill.style.transition = 'none';
    this.skill.style.opacity = '1';
    this.skillTimer = 0.9;
  }

  /** growth callout */
  showPop(label: string, total: number) {
    this.popG.textContent = label;
    this.popT.textContent = `SHIKIGAMI ${total}`;
    this.pop.style.transition = 'none';
    this.pop.style.opacity = '1';
    this.popTimer = 0.9;
  }

  /** the big recall payoff counter; `formula` marks a composed 術式 */
  showHits(n: number, formula = false) {
    this.hits.textContent = n + ' HITS';
    this.hits.classList.toggle('formula', formula);
    this.hits.style.transition = 'none';
    this.hits.style.opacity = '1';
    this.hits.style.transform = 'translateX(-50%) scale(1.12)';
    this.hitsTimer = 0.85;
  }

  update(dt: number, playerMoved: boolean) {
    if (this.reminderTimer > 0) {
      this.reminderTimer -= dt;
      if (this.reminderTimer <= 0) this.reminder.classList.remove('on');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('on');
    }
    if (this.skillTimer > 0) {
      this.skillTimer -= dt;
      if (this.skillTimer <= 0) {
        this.skill.style.transition = 'opacity .45s';
        this.skill.style.opacity = '0';
      }
    }
    if (this.popTimer > 0) {
      this.popTimer -= dt;
      if (this.popTimer <= 0) {
        this.pop.style.transition = 'opacity .4s';
        this.pop.style.opacity = '0';
      }
    }
    if (this.hitsTimer > 0) {
      this.hitsTimer -= dt;
      if (this.hitsTimer <= 0) {
        this.hits.style.transition = 'opacity .5s, transform .5s';
        this.hits.style.opacity = '0';
        this.hits.style.transform = 'translateX(-50%) scale(0.9)';
      }
    }
    if (playerMoved && this.controlsFade > 0) {
      this.controlsFade = Math.max(0, this.controlsFade - dt * 0.3);
      this.controls.style.opacity = this.controlsFade.toFixed(2);
    }
  }

  showEnd(victory: boolean, title: string, statsHtml: string) {
    this.end.classList.add('on');
    this.end.classList.toggle('win', victory);
    this.end.classList.toggle('lose', !victory);
    this.endTitle.textContent = title;
    this.endStats.innerHTML = statsHtml;
  }

  reset() {
    this.hideOutro();
    this.setFade(0, 0.4);
    this.objective.classList.remove('on');
    this.end.classList.remove('on', 'win', 'lose');
    this.showBoss(false);
    this.hideBanner();
    this.skill.style.opacity = '0';
    this.pop.style.opacity = '0';
    this.hits.style.opacity = '0';
    this.controlsFade = 1;
    this.controls.style.opacity = '1';
    this.shownMax = -1;
  }
}
