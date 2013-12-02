/*
 * Copyright Olli Etuaho 2013.
 */

/**
 * Utility for generating a series of individual tip sample positions from
 * control points.
 * @param {boolean} fillShortSegments If true, segments smaller than one pixel
 * are filled with a circle with reduced flow.
 * @param {boolean} randomRotation If true, tip samples are going to be randomly
 * rotated. If true, there's no guarantee that two identical inputs will
 * generate the same rotation output values.
 * @constructor
 */
var BrushTipMover = function(fillShortSegments, randomRotation) {
    this.fillShortSegments = fillShortSegments;
    this.randomRotation = randomRotation;
    this.target = null;
};

/**
 * @const
 */
BrushTipMover.lineSegmentLength = 5.0;

/**
 * Reset the brush tip position and the target to draw to.
 * @param {Object} target Target that implements the fillCircle interface.
 * @param {number} x Horizontal position to place the tip to.
 * @param {number} y Vertical position to place the tip to.
 * @param {number} pressure Pressure at the start of the stroke.
 * @param {number} radius Radius of the stroke.
 * @param {number} flow Alpha value affecting the alpha of individual fillCircle calls.
 * @param {number} scatterOffset Relative amount of random offset for each fillCircle call.
 * @param {number} spacing Amount of spacing between fillCircle calls.
 * @param {boolean} relativeSpacing If true, spacing is interpreted as relative to the current radius.
 */
BrushTipMover.prototype.reset = function(target, x, y, pressure, radius, flow, scatterOffset,
                                         spacing, relativeSpacing) {
    this.target = target;

    this.targetX = x;
    this.targetY = y;
    this.targetR = pressure * radius;
    this.t = 0;

    this.x = x;
    this.y = y;
    this.pressure = pressure;
    this.radius = radius;
    this.flow = flow;
    this.scatterOffset = scatterOffset;
    this.spacing = spacing;
    this.relativeSpacing = relativeSpacing;
    var nBlends = this.radius * 2;
    this.continuous = !this.relativeSpacing && this.spacing === 1 && this.scatterOffset === 0;
    if (this.continuous) {
        this.drawFlowAlpha = colorUtil.alphaForNBlends(this.flow, nBlends);
    } else {
        var realSpacing = this.spacing * (this.relativeSpacing ? this.radius : 1.0);
        var blendSpacing = Math.min(realSpacing, this.radius * 2);
        nBlends = this.radius * 2 / blendSpacing;
        this.drawFlowAlpha = colorUtil.alphaForNBlends(this.flow, nBlends);
    }

    this.direction = new Vec2(0, 0);
};

/**
 * Move the brush tip.
 * @param {number} x Horizontal position to move the tip to.
 * @param {number} y Vertical position to move the tip to.
 * @param {number} pressure Pressure at the position to move to.
 */
BrushTipMover.prototype.move = function(x, y, pressure) {
    var xd, yd, pd, rd;
    var dx = x - this.x;
    var dy = y - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);

    // Brush smoothing. By default, make a straight line.
    var bezierX = this.x + dx * 0.5;
    var bezierY = this.y + dy * 0.5;
    if (dx * this.direction.x + dy * this.direction.y > d * 0.5) {
        // ad-hoc weighing of points to get a visually pleasing result
        bezierX = this.x + this.direction.x * d * 0.25 + dx * 0.25;
        bezierY = this.y + this.direction.y * d * 0.25 + dy * 0.25;
    }

    if (d < this.t) {
        if (this.continuous && this.fillShortSegments) {
            // this.t - 1.0 is basically how far this.t was from the end of the previous segment when the previous
            // circle was drawn.
            // TODO: assert(this.t - 1.0 <= 0);
            var step = d * 0.5 - (this.t - 1.0);
            if (100000 * step > this.radius * 2) {
                var drawFlowAlpha = colorUtil.alphaForNBlends(this.flow, Math.ceil(this.radius * 2 / step));
                this.target.fillCircle(bezierX, bezierY, (pressure + this.pressure) * 0.5 * this.radius,
                                       drawFlowAlpha, 0);
            }
            this.t = 1.0 - d * 0.5;
        } else {
            this.t -= d;
        }
        this.targetX = x;
        this.targetY = y;
        this.targetR = pressure * this.radius;
    } else {
        // we'll split the smoothed stroke segment to line segments with approx
        // length of BrushTipMover.lineSegmentLength, trying to fit them nicely
        // between the two stroke segment endpoints
        var t = 0;
        var tSegment = 0.99999 / Math.ceil(d / BrushTipMover.lineSegmentLength);
        while (t < 1.0) {
            xd = this.x * Math.pow(1.0 - t, 2) + bezierX * t * (1.0 - t) * 2 +
                 x * Math.pow(t, 2);
            yd = this.y * Math.pow(1.0 - t, 2) + bezierY * t * (1.0 - t) * 2 +
                 y * Math.pow(t, 2);
            pd = this.pressure + (pressure - this.pressure) * t;
            rd = pd * this.radius;
            this.circleLineTo(xd, yd, rd, 0);
            t += tSegment;
        }
    }
    // The tangent of the bezier curve at the end of the curve intersects
    // with the control point, we get the next step's starting direction
    // from there.
    this.direction.x = x - bezierX;
    this.direction.y = y - bezierY;
    this.direction.normalize();
    this.x = x;
    this.y = y;
    this.pressure = pressure;
};

/**
 * Draw a series of circles from the current target point and radius to the given
 * point and radius. Radius, x, and y values for circles along the line are
 * interpolated linearly from the previous parameters to this function. Circles
 * are placed at 1 pixel intervals along the path, a circle doesn't necessarily
 * end up exactly at the end point. On the first call, doesn't draw anything.
 * @param {number} centerX The x coordinate of the center of the circle at the
 * end of the line.
 * @param {number} centerY The y coordinate of the center of the circle at the
 * end of the line.
 * @param {number} radius The radius at the end of the line.
 * @param {number} rotation Rotation at the end of the line in radians. TODO: Take this into account.
 */
BrushTipMover.prototype.circleLineTo = function(centerX, centerY, radius, rotation) {
    if (this.targetX !== null) {
        var diff = new Vec2(centerX - this.targetX, centerY - this.targetY);
        var d = diff.length();
        while (this.t < d) {
            var t = this.t / d;
            var offset = Math.random() * this.scatterOffset * radius;
            var offsetAngle = Math.random() * 2 * Math.PI;
            var rot = this.randomRotation ? Math.random() * 2 * Math.PI : 0;
            this.target.fillCircle(this.targetX + diff.x * t + offset * Math.sin(offsetAngle),
                                   this.targetY + diff.y * t + offset * Math.cos(offsetAngle),
                                   this.targetR + (radius - this.targetR) * t,
                                   this.drawFlowAlpha,
                                   rot);
            this.t += Math.max(this.spacing * (this.relativeSpacing ? radius : 1.0), 1.0);
        }
        this.t -= d;
    }
    this.targetX = centerX;
    this.targetY = centerY;
    this.targetR = radius;
};
