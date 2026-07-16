
// ============================================================
// THEME DIAL
// ============================================================
var dialThemes = [
  { name: 'Red',    color: '#E84040', dim: '#5a1a1a', mid: '#8a2a2a', faint: '#3a1515', glow: 'rgba(232,64,64,0.3)',  angle: 0,         active: true, themeClass: 'theme-red' },
  { name: 'Orange', color: '#F07020', dim: '#5a2e10', mid: '#8a4518', faint: '#3a1e0a', glow: 'rgba(240,112,32,0.3)', angle: 360/7,     active: true, themeClass: 'theme-orange' },
  { name: 'Yellow', color: '#f0c850', dim: '#5a4a1e', mid: '#8a702a', faint: '#3a3015', glow: 'rgba(240,200,80,0.3)', angle: 2*360/7,   active: true, themeClass: '' },
  { name: 'Green',  color: '#28A85E', dim: '#10422a', mid: '#1a6a3a', faint: '#0a2a1a', glow: 'rgba(40,168,94,0.3)',  angle: 3*360/7,   active: true, themeClass: 'theme-green' },
  { name: 'Blue',   color: '#6ac0f0', dim: '#1a3a5a', mid: '#2a5a8a', faint: '#102a3a', glow: 'rgba(106,192,240,0.3)', angle: 4*360/7, active: true, themeClass: 'theme-day' },
  { name: 'Indigo', color: '#5B4FCF', dim: '#221a5a', mid: '#352a8a', faint: '#18123a', glow: 'rgba(91,79,207,0.3)',  angle: 5*360/7,   active: true, themeClass: 'theme-indigo' },
  { name: 'Violet', color: '#A855C8', dim: '#42205a', mid: '#6a308a', faint: '#2a153a', glow: 'rgba(168,85,200,0.3)', angle: 6*360/7,   active: true, themeClass: 'theme-violet' }
];

var dialCurrentIndex = 2;
var dialCurrentAngle = dialThemes[2].angle;
var dialCogAngle = 0;
var dialTargetAngle = dialCurrentAngle;
var dialAnimating = false;
var dialDragging = false;
var dialLastDragAngle = null;
var dialNS = 'http://www.w3.org/2000/svg';

(function initDial() {
  var cogTeethEl = document.getElementById('cog-teeth');
  var numTeeth = 14, cogR = 30, toothH = 7, toothW = 8;
  window.dialToothPolys = [];
  for (var i = 0; i < numTeeth; i++) {
    var a = (i / numTeeth) * Math.PI * 2;
    var a1 = a - (toothW/2) / (cogR + toothH);
    var a2 = a + (toothW/2) / (cogR + toothH);
    var a1i = a - (toothW/2.8) / cogR;
    var a2i = a + (toothW/2.8) / cogR;
    var outerR = cogR + toothH;
    var pts = [
      (80 + cogR * Math.cos(a1i)) + ',' + (80 + cogR * Math.sin(a1i)),
      (80 + outerR * Math.cos(a1)) + ',' + (80 + outerR * Math.sin(a1)),
      (80 + outerR * Math.cos(a2)) + ',' + (80 + outerR * Math.sin(a2)),
      (80 + cogR * Math.cos(a2i)) + ',' + (80 + cogR * Math.sin(a2i))
    ].join(' ');
    var poly = document.createElementNS(dialNS, 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', '#3a3015');
    poly.setAttribute('stroke', '#5a4a1e');
    poly.setAttribute('stroke-width', '0.5');
    cogTeethEl.appendChild(poly);
    window.dialToothPolys.push(poly);
  }

  var knurlGroup = document.getElementById('knurl-lines');
  window.dialKnurlLines = [];
  for (var i = 0; i < 24; i++) {
    var a = (i / 24) * Math.PI * 2;
    var line = document.createElementNS(dialNS, 'line');
    line.setAttribute('x1', 80 + 14 * Math.cos(a));
    line.setAttribute('y1', 80 + 14 * Math.sin(a));
    line.setAttribute('x2', 80 + 21 * Math.cos(a));
    line.setAttribute('y2', 80 + 21 * Math.sin(a));
    line.setAttribute('stroke', '#5a4a1e');
    line.setAttribute('stroke-width', '0.8');
    knurlGroup.appendChild(line);
    window.dialKnurlLines.push(line);
  }

  var tickGroup = document.getElementById('dial-ticks');
  dialThemes.forEach(function(t, i) {
    var rad = (t.angle - 90) * Math.PI / 180;
    var tick = document.createElementNS(dialNS, 'line');
    tick.setAttribute('x1', 80 + 62 * Math.cos(rad));
    tick.setAttribute('y1', 80 + 62 * Math.sin(rad));
    tick.setAttribute('x2', 80 + 68 * Math.cos(rad));
    tick.setAttribute('y2', 80 + 68 * Math.sin(rad));
    tick.setAttribute('stroke', t.active ? t.color : '#333');
    tick.setAttribute('stroke-width', '2');
    tick.setAttribute('stroke-linecap', 'round');
    tick.setAttribute('opacity', t.active ? '0.35' : '0.15');
    tick.id = 'dtick-' + i;
    tickGroup.appendChild(tick);
  });

  var dotsGroup = document.getElementById('dial-dots');
  dialThemes.forEach(function(t, i) {
    var rad = (t.angle - 90) * Math.PI / 180;
    var cx = 80 + 55 * Math.cos(rad);
    var cy = 80 + 55 * Math.sin(rad);
    var dot = document.createElementNS(dialNS, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', t.active ? t.color : '#333');
    dot.setAttribute('opacity', t.active ? '0.5' : '0.2');
    dot.setAttribute('style', t.active ? 'cursor:pointer;' : 'cursor:not-allowed;');
    dot.id = 'ddot-' + i;
    dot.addEventListener('click', function(e) {
      e.stopPropagation();
      if (dialThemes[i].active) dialSelectTheme(i);
    });
    dotsGroup.appendChild(dot);
  });

  // Events
  var dc = document.getElementById('dial-container');
  dc.addEventListener('mousedown', function(e) { dialDragging = true; dc.style.cursor = 'grabbing'; dialHandleDrag(e); });
  dc.addEventListener('keydown', function(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    var direction = e.key === 'ArrowRight' ? 1 : -1;
    var nextIndex = (dialCurrentIndex + direction + dialThemes.length) % dialThemes.length;
    dialSelectTheme(nextIndex);
  });
  document.addEventListener('mousemove', function(e) { if (dialDragging) dialHandleDrag(e); });
  document.addEventListener('mouseup', function() { if (dialDragging) { dialDragging = false; dc.style.cursor = 'grab'; dialLastDragAngle = null; dialSnapToNearest(); } });
  dc.addEventListener('touchstart', function(e) { dialDragging = true; dialHandleDrag(e.touches[0]); }, {passive: true});
  document.addEventListener('touchmove', function(e) { if (dialDragging) dialHandleDrag(e.touches[0]); }, {passive: true});
  document.addEventListener('touchend', function() { if (dialDragging) { dialDragging = false; dialLastDragAngle = null; dialSnapToNearest(); } });

  dialSelectTheme(2);
  dialUpdateIndicator(dialThemes[2].angle);
})();

function dialTintCog(t) {
  document.getElementById('cog-body').setAttribute('stroke', t.mid);
  document.getElementById('cog-body').setAttribute('fill', t.faint);
  document.getElementById('dial-axle-center').setAttribute('fill', t.dim);
  document.getElementById('dial-axle-center').setAttribute('stroke', t.mid);
  window.dialToothPolys.forEach(function(p) { p.setAttribute('fill', t.faint); p.setAttribute('stroke', t.dim); });
  window.dialKnurlLines.forEach(function(l) { l.setAttribute('stroke', t.dim); });
}

function dialUpdateIndicator(angle) {
  var rad = (angle - 90) * Math.PI / 180;
  var lx = 80 + 30 * Math.cos(rad);
  var ly = 80 + 30 * Math.sin(rad);
  document.getElementById('dial-indicator').setAttribute('x2', lx);
  document.getElementById('dial-indicator').setAttribute('y2', ly);
  document.getElementById('dial-indicator-dot').setAttribute('cx', lx);
  document.getElementById('dial-indicator-dot').setAttribute('cy', ly);
}

function dialUpdateCog(angle) {
  document.getElementById('cog-group').setAttribute('transform', 'rotate(' + angle + ' 80 80)');
}

function dialSelectTheme(index) {
  if (!dialThemes[index].active) return;
  dialCurrentIndex = index;
  var t = dialThemes[index];
  dialTargetAngle = t.angle;

  document.getElementById('dial-indicator').setAttribute('stroke', t.color);
  document.getElementById('dial-indicator-dot').setAttribute('fill', t.color);
  document.getElementById('dial-label').textContent = t.name;
  document.getElementById('dial-label').style.color = t.color;
  document.getElementById('dial-label').style.textShadow = '0 0 6px ' + t.glow;
  var dialContainer = document.getElementById('dial-container');
  dialContainer.setAttribute('aria-valuenow', index);
  dialContainer.setAttribute('aria-valuetext', t.name);
  dialTintCog(t);

  dialThemes.forEach(function(_, j) {
    if (!dialThemes[j].active) return;
    var dot = document.getElementById('ddot-' + j);
    var tick = document.getElementById('dtick-' + j);
    if (j === index) {
      dot.setAttribute('opacity', '1'); dot.setAttribute('r', '5');
      tick.setAttribute('opacity', '0.8'); tick.setAttribute('stroke-width', '2.5');
    } else {
      dot.setAttribute('opacity', '0.4'); dot.setAttribute('r', '3.5');
      tick.setAttribute('opacity', '0.25'); tick.setAttribute('stroke-width', '1.5');
    }
  });

  // Apply theme class
  document.body.className = t.themeClass || '';

  if (!dialAnimating) dialAnimateDial();
}

function dialAnimateDial() {
  dialAnimating = true;
  function step() {
    var diff = dialTargetAngle - dialCurrentAngle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) < 0.5) {
      dialCurrentAngle = dialTargetAngle;
      dialUpdateIndicator(dialCurrentAngle);
      dialAnimating = false;
      return;
    }
    var amt = diff * 0.12;
    dialCurrentAngle += amt;
    dialCogAngle += amt * 2.5;
    if (dialCurrentAngle < 0) dialCurrentAngle += 360;
    if (dialCurrentAngle >= 360) dialCurrentAngle -= 360;
    dialUpdateIndicator(dialCurrentAngle);
    dialUpdateCog(dialCogAngle);
    requestAnimationFrame(step);
  }
  step();
}

function dialHandleDrag(e) {
  var rect = document.getElementById('dial-container').getBoundingClientRect();
  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.height / 2;
  var angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
  if (angle < 0) angle += 360;

  if (dialLastDragAngle !== null) {
    var delta = angle - dialLastDragAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    dialCogAngle += delta * 2.5;
    dialUpdateCog(dialCogAngle);
  }
  dialLastDragAngle = angle;
  dialCurrentAngle = angle;
  dialTargetAngle = angle;
  dialUpdateIndicator(angle);

  // Find closest ACTIVE theme
  var closest = dialCurrentIndex, minDiff = 999;
  dialThemes.forEach(function(t, i) {
    if (!t.active) return;
    var d = Math.abs(angle - t.angle);
    if (d > 180) d = 360 - d;
    if (d < minDiff) { minDiff = d; closest = i; }
  });
  if (closest !== dialCurrentIndex) {
    dialCurrentIndex = closest;
    var t = dialThemes[closest];
    document.getElementById('dial-indicator').setAttribute('stroke', t.color);
    document.getElementById('dial-indicator-dot').setAttribute('fill', t.color);
    document.getElementById('dial-label').textContent = t.name;
    document.getElementById('dial-label').style.color = t.color;
    document.getElementById('dial-label').style.textShadow = '0 0 6px ' + t.glow;
    document.getElementById('dial-container').setAttribute('aria-valuenow', closest);
    document.getElementById('dial-container').setAttribute('aria-valuetext', t.name);
    dialTintCog(t);
    document.body.className = t.themeClass || '';
    dialThemes.forEach(function(_, j) {
      if (!dialThemes[j].active) return;
      var dot = document.getElementById('ddot-' + j);
      var tick = document.getElementById('dtick-' + j);
      if (j === closest) {
        dot.setAttribute('opacity', '1'); dot.setAttribute('r', '5');
        tick.setAttribute('opacity', '0.8'); tick.setAttribute('stroke-width', '2.5');
      } else {
        dot.setAttribute('opacity', '0.4'); dot.setAttribute('r', '3.5');
        tick.setAttribute('opacity', '0.25'); tick.setAttribute('stroke-width', '1.5');
      }
    });
  }
}

function dialSnapToNearest() {
  var closest = dialCurrentIndex, minDiff = 999;
  dialThemes.forEach(function(t, i) {
    if (!t.active) return;
    var d = Math.abs(dialCurrentAngle - t.angle);
    if (d > 180) d = 360 - d;
    if (d < minDiff) { minDiff = d; closest = i; }
  });
  dialSelectTheme(closest);
}


