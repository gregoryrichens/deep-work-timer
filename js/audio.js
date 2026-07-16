// AUDIO
var AudioEngine = (function() {
  var ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function playDoorChime(dur) {
    var ac = getCtx(), t = ac.currentTime;
    while (t < ac.currentTime + dur) {
      [[880,1174.66,'sine',0.22],[1318.51,1318.51,'sine',0.14],[1760,2093,'triangle',0.05]].forEach(function(p) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = p[2]; o.frequency.setValueAtTime(p[0],t);
        o.frequency.exponentialRampToValueAtTime(p[1],t+0.18);
        g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(p[3],t+0.04);
        g.gain.setValueAtTime(p[3],t+0.12); g.gain.exponentialRampToValueAtTime(0.001,t+0.6);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t+0.65);
      }); t += 2.2;
    }
  }
  function playYeahBuddy() {
    var ac = getCtx(), t = ac.currentTime;
    var bass = ac.createOscillator(), bg = ac.createGain();
    bass.type='sawtooth'; bass.frequency.setValueAtTime(110,t);
    bass.frequency.exponentialRampToValueAtTime(70,t+0.4);
    bg.gain.setValueAtTime(0.3,t); bg.gain.exponentialRampToValueAtTime(0.001,t+0.5);
    bass.connect(bg).connect(ac.destination); bass.start(t); bass.stop(t+0.5);
    [280,560,1120,2240].forEach(function(f,i) {
      var o=ac.createOscillator(), g=ac.createGain();
      o.type='sawtooth'; o.frequency.setValueAtTime(f,t);
      o.frequency.linearRampToValueAtTime(f*1.3,t+0.2);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.09/(i+1),t+0.04);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.35);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t+0.4);
    });
    setTimeout(function() {
      var ac2=getCtx(), t2=ac2.currentTime;
      [380,760,1520,3040].forEach(function(f,i) {
        var o=ac2.createOscillator(), g=ac2.createGain();
        o.type='square'; o.frequency.setValueAtTime(f,t2);
        g.gain.setValueAtTime(0,t2); g.gain.linearRampToValueAtTime(0.07/(i+1),t2+0.03);
        g.gain.exponentialRampToValueAtTime(0.001,t2+0.3);
        o.connect(g).connect(ac2.destination); o.start(t2); o.stop(t2+0.35);
      });
    }, 320);
  }
  return { playDoorChime: playDoorChime, playYeahBuddy: playYeahBuddy };
})();

