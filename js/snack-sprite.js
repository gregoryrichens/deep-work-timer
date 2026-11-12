// Exercise snack sprite: a 4-colour pixel-art image, palette-swapped to the active theme.
// The rust tone becomes the theme's dark shade (--pip-dim) and the orange tone becomes its
// midtone (--pip-primary). Near-black shadows, pale highlights and transparency are kept,
// so the pixel grid and checkerboard dithering stay intact.
var SnackSprite = (function() {
  var RUST = [165, 40, 10];
  var ORANGE = [244, 123, 40];
  var canvas, ctx, source, img;

  function cssColor(name) {
    // Let the canvas normalise any CSS colour to #rrggbb.
    ctx.fillStyle = '#000';
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue(name).trim() || '#000';
    var hex = ctx.fillStyle;
    return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
  }

  function paint() {
    if (!ctx || !img || !img.complete || !img.naturalWidth) return;
    if (!source) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      try {
        source = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (e) {
        // Canvas is tainted (e.g. index.html opened via file://): show the original colours.
        return;
      }
    }
    var dark = cssColor('--pip-dim');
    var mid = cssColor('--pip-primary');
    var out = ctx.createImageData(source.width, source.height);
    var s = source.data, d = out.data;
    for (var i = 0; i < s.length; i += 4) {
      var r = s[i], g = s[i + 1], b = s[i + 2], to = null;
      if (r === RUST[0] && g === RUST[1] && b === RUST[2]) to = dark;
      else if (r === ORANGE[0] && g === ORANGE[1] && b === ORANGE[2]) to = mid;
      if (to) { d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; }
      else { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
      d[i + 3] = s[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  }

  function init() {
    canvas = document.getElementById('snack-sprite');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    img = new Image();
    img.onload = function() {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      source = null;
      paint();
    };
    img.src = canvas.getAttribute('data-src');
    // The theme dial swaps the class on <body>; repaint whenever that happens.
    new MutationObserver(paint).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { paint: paint };
})();
