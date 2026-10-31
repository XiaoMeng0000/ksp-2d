'use strict';

// 恒星着色器（KSP 风格：光球丝缕 + 流光光晕 + 远景星芒），GLSL ES 3.00。
//
// 单 pass、无贴图、无离屏目标：片元着色器按屏幕坐标解析球面，直接输出显示色。
//   · 光球：解析球面 + 域扭曲 ridged 噪声丝缕；按像素波长淡出高倍频（小盘面不闪）。
//   · 光晕：近缘指数 + 长尾 + 角向流光（不是均匀圆环），在 uHaloReach 处平滑截止。
//   · 星芒：长度按像素固定（不随盘面缩小），由 uSpikeWeight 在小盘面淡入。
//   · 输出：显示映射 1 − exp(−x) → 伽马 2.2 编码 → 直线 alpha（透明模式）。
//
// 全屏三角形由 gl_VertexID 生成，不需要顶点缓冲。

export const STAR_VERT = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const STAR_FRAG = `#version 300 es
precision highp float;

uniform vec2 uCenter;           // 星心（设备像素，GL 坐标：原点左下）
uniform float uRadius;          // 盘面半径（设备像素）
uniform float uDpr;
uniform float uTime;            // 视觉时间（秒）

uniform vec3 uBaseColor;        // HDR（显示映射后还原目标色）
uniform vec3 uFilamentColor;    // HDR
uniform vec3 uRimColor;         // 线性叠加光
uniform float uFilamentScale;
uniform float uFilamentThreshold;
uniform float uFilamentContrast;
uniform float uCellDarkening;
uniform float uLimbDarkening;
uniform float uRimPower;
uniform float uRimStrength;
uniform float uRotationRate;
uniform float uFlowRate;
uniform float uFarBlend;

uniform vec3 uHaloColor;
uniform float uHaloStrength;    // 0 = 光晕关闭
uniform float uHaloScale;       // 特征宽度（设备像素）
uniform float uHaloReach;       // 截止距离（设备像素，自盘缘起算）
uniform float uRayStrength;
uniform float uRayCount;

uniform vec3 uSpikeColor;
uniform float uSpikeWeight;     // 0 = 不画星芒
uniform float uSpikeLength;     // 设备像素
uniform float uSpikeWidth;      // 设备像素
uniform float uSpikeStrength;
uniform float uDiagonalStrength;

uniform float uExposure;
uniform float uVisibility;      // 1 − occlusion
uniform float uTransparent;     // 1 = 直线 alpha 输出；0 = 不透明（黑底）

out vec4 outColor;

vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float gnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i), f),
                       dot(hash3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
                   mix(dot(hash3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)),
                       dot(hash3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)),
                       dot(hash3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
                   mix(dot(hash3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)),
                       dot(hash3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y), u.z);
}

float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
        s += a * gnoise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return s;
}

// 丝缕：ridged 噪声的细脊；波长短于 3 像素的倍频淡出（防小盘面闪烁）
float ridged(vec3 p, float pxPerUnit) {
    float a = 0.5;
    float s = 0.0;
    float norm = 0.0;
    float freq = 1.0;
    for (int i = 0; i < 6; i++) {
        float wavePx = pxPerUnit / freq;
        float fade = clamp((wavePx - 3.0) / 3.0, 0.0, 1.0);
        float n = 1.0 - abs(gnoise(p));
        s += a * fade * pow(n, 7.0);
        norm += a * fade;
        p = p * 2.07 + vec3(5.1, 1.3, 7.7);
        freq *= 2.07;
        a *= 0.7;
    }
    return norm > 0.0 ? s / norm : 0.0;
}

void main() {
    vec2 q = gl_FragCoord.xy - uCenter;
    float rpx = length(q);
    float R = uRadius;
    float radiusCss = R / uDpr;
    vec3 col = vec3(0.0);
    float diskA = clamp(R - rpx + 0.5, 0.0, 1.0);

    // ---- 光球 ----
    if (diskA > 0.0) {
        vec2 p = q / R;
        float z = sqrt(max(1.0 - dot(p, p), 0.0));
        vec3 N = vec3(p, z);
        float ang = uTime * uRotationRate;
        float ca = cos(ang);
        float sa = sin(ang);
        vec3 Nr = vec3(ca * N.x + sa * N.z, N.y, -sa * N.x + ca * N.z);
        vec3 P = Nr * uFilamentScale;
        float ft = uTime * uFlowRate;
        vec3 w = vec3(fbm(P * 0.5 + vec3(0.0, 0.0, ft)),
                      fbm(P * 0.5 + vec3(5.2, 1.3, -0.85 * ft)),
                      fbm(P * 0.5 + vec3(2.1, 7.7, 0.65 * ft)));
        float fil = ridged(P + 3.5 * w, R / uFilamentScale * max(z, 0.25));
        float cell = fbm(P * 1.3 + 1.5 * w);
        float detail = smoothstep(5.0, 36.0, radiusCss);
        float filMask = smoothstep(uFilamentThreshold, uFilamentThreshold + 0.18, fil)
            * uFilamentContrast * detail;
        vec3 surf = uBaseColor * (1.0 - uCellDarkening * detail * clamp(cell * 2.0 + 0.5, 0.0, 1.0));
        surf = mix(surf, uFilamentColor, clamp(filMask, 0.0, 1.0));
        surf *= mix(1.0, 0.55 + 0.45 * z, uLimbDarkening);
        surf += uRimColor * pow(1.0 - z, uRimPower) * uRimStrength;
        surf = mix(surf, uSpikeColor * 4.0, uFarBlend * 0.7);
        col += surf * diskA;
    }

    // ---- 光晕：近缘亮、长尾为角向流光 ----
    if (uHaloStrength > 0.0) {
        float h = max(rpx - R, 0.0);
        float x = h / uHaloScale;
        // 收尾窗：(1−u)^4 在线性域，经伽马编码后显示亮度约 (1−u)^1.8，
        // 在 uHaloReach 处斜率归零 ⇒ 没有可见的外圈边界（旧版在亮度还有 ~44/255 时被截断，像一块贴在背后的圆盘）
        float u = clamp(h / uHaloReach, 0.0, 1.0);
        float win = (1.0 - u) * (1.0 - u);
        win *= win;
        float g = 0.6 * exp(-2.5 * x) + 0.4 * exp(-0.8 * x);
        float theta = atan(q.y, q.x);
        vec3 ringP = vec3(cos(theta), sin(theta), 0.0) * uRayCount * 0.35;
        float rn = fbm(ringP + vec3(0.0, 0.0, uTime * 0.02))
            + 0.5 * fbm(ringP * 2.3 - vec3(0.0, 0.0, uTime * 0.015));
        float rayRamp = smoothstep(0.0, 0.25, x);
        // 流光比底层辉光衰减更慢、收尾窗更宽（(1−u)^3），从辉光里"伸出去"而不是一起结束
        float rayWin = (1.0 - u) * (1.0 - u) * (1.0 - u);
        float rays = pow(max(rn + 0.15, 0.0) * 2.0, 1.6) * exp(-0.35 * x) * rayWin;
        // 紧贴盘缘处不分流给流光（rayRamp=0），光晕从盘缘亮度连续接出，不出现台阶
        g = g * win * (1.0 - 0.5 * uRayStrength * rayRamp) + uRayStrength * 0.5 * rays * rayRamp;
        col += uHaloColor * uHaloStrength * g * (1.0 - diskA);
    }

    // ---- 星芒：十字主芒 + 斜向弱芒 + 核心 ----
    if (uSpikeWeight > 0.0) {
        float L = uSpikeLength;
        float W = uSpikeWidth;
        vec2 aq = abs(q);
        float sp = 0.0;
        sp += exp(-aq.y / (W * (1.0 - 0.6 * min(aq.x / L, 1.0)))) * pow(max(1.0 - aq.x / L, 0.0), 2.5);
        sp += exp(-aq.x / (W * (1.0 - 0.6 * min(aq.y / L, 1.0)))) * pow(max(1.0 - aq.y / L, 0.0), 2.5);
        vec2 dq = abs(vec2(q.x + q.y, q.x - q.y) * 0.70710678);
        float Ld = L * 0.45;
        sp += uDiagonalStrength * exp(-dq.y / W) * pow(max(1.0 - dq.x / Ld, 0.0), 2.5);
        sp += uDiagonalStrength * exp(-dq.x / W) * pow(max(1.0 - dq.y / Ld, 0.0), 2.5);
        // 核心辉光在芒长 70%~100% 处平滑截止：指数尾巴经伽马编码会放大到 ~1.5/255，
        // 不截止的话局部画布边缘会残留非零 alpha（包围盒判据余量为零）
        float core = exp(-rpx / (W * 3.0 + R * 0.5)) * (1.0 - smoothstep(0.7 * L, L, rpx));
        col += uSpikeColor * uSpikeStrength * uSpikeWeight * (sp + core);
    }

    col *= uVisibility;

    // ---- 显示映射 → 输出 ----
    vec3 disp = 1.0 - exp(-col * uExposure);
    vec3 srgb = pow(disp, vec3(1.0 / 2.2));
    if (uTransparent > 0.5) {
        // 直线 alpha：alpha 取最大通道（盘面内 = 1），RGB 除回 alpha。
        // 合成到黑底时正好还原 srgb；alpha 只表示覆盖度，不当亮度用。
        float a = max(max(max(srgb.r, srgb.g), srgb.b), diskA * uVisibility);
        outColor = a > 0.0 ? vec4(srgb / a, a) : vec4(0.0);
    } else {
        outColor = vec4(srgb, 1.0);
    }
}
`;
