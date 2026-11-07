'use strict';

// 3D 飞船着色器（GLSL ES 3.00 · v3.1 程序化航天 PBR 材质与微凹凸法线版）
// 支持 7 类航天材质（vMaterial.x = matId）：
//   0: HULL_PAINTED  — 航天漆面蒙皮（环/纵蒙皮接缝、铆钉点阵、微颗粒粗糙度）
//   1: HEAT_SHIELD   — 烧蚀防热底盾 / 炭黑结构件（蜂窝防热瓦网格与边缘炭化）
//   2: CRYO_FOAM     — 低温绝热泡沫（密集纵向加强筋凹凸波纹 + 哑光颗粒）
//   3: METAL_RING    — 拉丝钛合金 / 钢箍法兰（高金属度 GGX + 环向车削纹 + 螺栓凹槽）
//   4: NOZZLE_BELL   — 发动机再生冷却喷管（密排轴向冷却管凸肋 + 环向焊缝 + 高温回火烤蓝/紫金渐变）
//   5: KAPTON_FOIL   — 多层褶皱金箔隔热膜（多频交叉折痕法线扰动 + 金色金属反光）
//   6: EMISSIVE_GLOW — 自发光舷窗 / 离子推进电离栅极 / 导航信标

export const SHIP_VERT = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;
in vec2 aMaterial;

uniform mat4 u_modelMatrix;
uniform mat3 u_normalMatrix;
uniform mat4 u_viewProjMatrix;

out vec3 vLocalPos;
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vColor;
out vec2 vMaterial;

void main() {
    vec4 world = u_modelMatrix * vec4(aPosition, 1.0);
    vLocalPos = aPosition;
    vWorldPos = world.xyz;
    vNormal = normalize(u_normalMatrix * aNormal);
    vColor = aColor;
    vMaterial = aMaterial;
    gl_Position = u_viewProjMatrix * world;
}
`;

export const SHIP_FRAG = `#version 300 es
precision highp float;

in vec3 vLocalPos;
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vColor;
in vec2 vMaterial;

uniform vec3 u_lightDir;
uniform vec3 u_cameraPos;
uniform float u_lightOn;
uniform float u_sunVisibility;
uniform float u_ambient;
uniform float u_diffuse;
uniform float u_specular;
uniform float u_shininess;
uniform vec4 u_tintColor;
uniform float u_opacity;

out vec4 outColor;

const float PI = 3.14159265359;

// 轻量 3D 哈希噪声（用于漆面颗粒与金箔折痕）
float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

void main() {
    vec3 baseColor = vColor;
    float matId = floor(vMaterial.x + 0.5);
    float partEmis = vMaterial.y;

    // 柱面局部坐标：(theta 角度 [-PI, PI], y 高度, r 径向距离)
    float theta = atan(vLocalPos.z, vLocalPos.x);
    float normTheta = (theta + PI) / (2.0 * PI); // 0 ~ 1
    float y = vLocalPos.y;
    float r = length(vLocalPos.xz);

    // 材质 PBR 基础参数
    float metallic = 0.12;
    float roughness = 0.52;
    float ao = 1.0;
    float heightVal = 0.0;

    if (matId < 0.5) {
        // === 0: HULL_PAINTED（航天白漆/工程黄蒙皮：蒙皮接缝 + 铆钉 + 微颗粒）===
        metallic = 0.15;
        roughness = 0.44;

        // 8 等分纵向蒙皮接缝 + 0.45m 间距环向接缝
        float seamAngular = abs(fract(normTheta * 8.0) - 0.5);
        float seamVertical = abs(fract(y * 2.2) - 0.5);
        float lineAng = smoothstep(0.028, 0.008, seamAngular);
        float lineVert = smoothstep(0.032, 0.010, seamVertical);
        float seam = max(lineAng, lineVert);

        // 接缝两侧铆钉阵列
        float rivetAng = abs(fract(normTheta * 48.0) - 0.5);
        float rivetVert = abs(fract(y * 2.2 + 0.05) - 0.5);
        float rivet = smoothstep(0.14, 0.05, length(vec2(rivetAng * 0.6, rivetVert * 4.5)));

        // 分块微色差（让相邻铝板有微妙明暗区分）
        float panelId = floor(normTheta * 8.0) + floor(y * 2.2) * 13.0;
        float panelVar = (fract(sin(panelId * 78.233) * 43758.5453) - 0.5) * 0.045;

        baseColor = baseColor * (1.0 + panelVar) * (1.0 - seam * 0.22 - rivet * 0.15);
        ao = 1.0 - seam * 0.30 - rivet * 0.18;
        heightVal = -seam * 0.015 + rivet * 0.008;
        roughness = clamp(roughness + seam * 0.25 - panelVar * 0.8, 0.25, 0.85);

    } else if (matId < 1.5) {
        // === 1: HEAT_SHIELD（烧蚀防热瓦 / 炭黑复合材料）===
        metallic = 0.08;
        roughness = 0.72;
        vec2 tileUv = vLocalPos.xz * 9.0 + vec2(y * 5.0);
        vec2 grid = abs(fract(tileUv) - 0.5);
        float tileSeam = smoothstep(0.46, 0.49, max(grid.x, grid.y));
        float radialChar = smoothstep(0.25, 0.72, r);
        baseColor = mix(baseColor, baseColor * vec3(0.75, 0.68, 0.62), radialChar * 0.45);
        baseColor *= (1.0 - tileSeam * 0.32);
        ao = 1.0 - tileSeam * 0.35;
        heightVal = -tileSeam * 0.018;

    } else if (matId < 2.5) {
        // === 2: CRYO_FOAM（低温波纹绝热层 / 缠绕储罐）===
        metallic = 0.06;
        roughness = 0.66;
        // 密集纵向波纹加强筋 (Corrugated stringers)
        float ribWave = sin(normTheta * 64.0 * 2.0 * PI);
        float ringBand = smoothstep(0.04, 0.01, abs(fract(y * 3.5) - 0.5));
        float grain = (hash31(floor(vLocalPos * 60.0)) - 0.5) * 0.05;
        baseColor = baseColor * (0.96 + 0.06 * ribWave + grain) * (1.0 - ringBand * 0.16);
        ao = 0.92 + 0.08 * ribWave;
        heightVal = ribWave * 0.014 - ringBand * 0.010;

    } else if (matId < 3.5) {
        // === 3: METAL_RING（拉丝钛合金 / 钢箍法兰 / 机械结构）===
        metallic = 0.84;
        roughness = 0.26;
        // 环向精密车削拉丝纹 + 螺栓凹坑
        float brush = sin(y * 160.0) * 0.5 + sin(normTheta * 24.0 * 2.0 * PI) * 0.5;
        float boltU = abs(fract(normTheta * 16.0) - 0.5);
        float bolt = smoothstep(0.11, 0.04, boltU);
        baseColor = baseColor * (0.97 + 0.04 * brush) * (1.0 - bolt * 0.20);
        ao = 1.0 - bolt * 0.25;
        heightVal = brush * 0.005 - bolt * 0.012;

    } else if (matId < 4.5) {
        // === 4: NOZZLE_BELL（发动机再生冷却喷管：细密冷却管肋 + 高温回火烤蓝/古铜渐变）===
        metallic = 0.88;
        roughness = 0.22;
        // 72 道再生冷却微通道凸肋 + 环向加强箍焊缝
        float coolingTube = sin(normTheta * 72.0 * 2.0 * PI);
        float weldRing = smoothstep(0.035, 0.010, abs(fract(y * 4.5) - 0.5));
        // 高温热回火色带（顶部喉道暗金铜 → 中段钛烤蓝紫 → 底部炭钢）
        float heatT = clamp((y + 0.55) / 0.85, 0.0, 1.0);
        vec3 temperGold = vec3(0.76, 0.55, 0.34);
        vec3 temperBlue = vec3(0.32, 0.38, 0.56);
        vec3 temperDark = baseColor;
        vec3 heatTint = mix(temperDark, mix(temperBlue, temperGold, smoothstep(0.35, 0.85, heatT)), 0.55);

        // 内壁（点乘视线与法线区分内外腔）略带暗红铜色烟炱
        baseColor = heatTint * (0.94 + 0.08 * coolingTube) * (1.0 + weldRing * 0.18);
        ao = 0.90 + 0.10 * coolingTube;
        heightVal = coolingTube * 0.016 + weldRing * 0.012;

    } else if (matId < 5.5) {
        // === 5: KAPTON_FOIL（多层褶皱聚酰亚胺金箔隔热膜）===
        metallic = 0.90;
        roughness = 0.24;
        float crinkle1 = sin(vLocalPos.x * 26.0 + vLocalPos.y * 19.0 - vLocalPos.z * 23.0);
        float crinkle2 = cos(vLocalPos.x * 41.0 - vLocalPos.y * 33.0 + vLocalPos.z * 29.0);
        float crinkle3 = sin((normTheta * 20.0 + y * 8.0) * 2.0 * PI);
        float foilFacet = (crinkle1 * 0.45 + crinkle2 * 0.35 + crinkle3 * 0.20);
        baseColor = baseColor * (0.95 + 0.10 * foilFacet);
        heightVal = foilFacet * 0.026;

    } else {
        // === 6: EMISSIVE_GLOW（舷窗玻璃 / 离子栅极 / 信标灯）===
        metallic = 0.92;
        roughness = 0.12;
    }

    // 叠加选中/悬停/拖拽预览染色
    vec3 albedo = mix(baseColor, u_tintColor.rgb, u_tintColor.a);

    if (u_lightOn < 0.5) {
        outColor = vec4(albedo, u_opacity);
        return;
    }

    // 利用屏幕空间偏导数（dFdx/dFdy）将程序化高度场 heightVal 转化为真实凹凸法线微扰动
    vec3 geomN = normalize(vNormal);
    vec3 dPdx = dFdx(vWorldPos);
    vec3 dPdy = dFdy(vWorldPos);
    float dHdx = dFdx(heightVal);
    float dHdy = dFdy(heightVal);
    vec3 surfGrad = (dHdx * cross(dPdy, geomN) + dHdy * cross(geomN, dPdx));
    vec3 n = normalize(geomN - surfGrad * 2.6);

    vec3 l = normalize(u_lightDir);
    vec3 v = normalize(u_cameraPos - vWorldPos);
    vec3 h = normalize(l + v);

    float ndotl = max(dot(n, l), 0.0);
    float ndotv = max(dot(n, v), 0.001);
    float ndoth = max(dot(n, h), 0.0);
    float vdoth = max(dot(v, h), 0.0);

    // PBR 菲涅尔基础反射率 F0（非金属 0.04，金属使用自身色相）
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdoth, 5.0);

    // GGX 法线分布函数 D
    float a = max(0.04, roughness * roughness);
    float a2 = a * a;
    float denom = (ndoth * ndoth * (a2 - 1.0) + 1.0);
    float D = a2 / max(PI * denom * denom, 1e-5);

    // Schlick-GGX 几何遮蔽项 G
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float G1V = ndotv / (ndotv * (1.0 - k) + k);
    float G1L = ndotl / (ndotl * (1.0 - k) + k);
    float G = G1V * G1L;

    vec3 specBrdf = (D * G * F) / max(4.0 * ndotv * max(ndotl, 0.001), 0.001);

    // 漫反射项（金属无漫反射）
    vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);
    vec3 directLight = (kD * albedo * u_diffuse + specBrdf * u_specular * 1.45) * ndotl * u_sunVisibility;

    // 车间与太空虚拟双半球环境反射（让金属喷管、金箔与法兰在暗部也有丰富高光层次）
    vec3 rDir = reflect(-v, n);
    float skyFactor = clamp(rDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 envSky = vec3(0.62, 0.74, 0.92);
    vec3 envGround = vec3(0.18, 0.20, 0.25);
    float horizonBand = exp(-abs(rDir.y) * 4.5) * 0.35;
    vec3 envColor = mix(envGround, envSky, skyFactor) + vec3(0.85, 0.90, 1.0) * horizonBand;
    vec3 envSpec = envColor * F * (1.0 - roughness * 0.72) * (0.28 + 0.42 * u_sunVisibility);

    // 半球漫反射环境光 + 边缘轮廓光
    float hemi = u_ambient + 0.14 * (n.y * 0.5 + 0.5);
    vec3 ambientTerm = kD * albedo * hemi * ao + envSpec * ao;
    float rim = pow(1.0 - ndotv, 3.2) * (0.10 + 0.12 * u_sunVisibility);

    // 自发光（舷窗、离子栅极、状态灯，不受日食阴影削弱）
    vec3 emissiveTerm = albedo * partEmis * 0.85;

    vec3 finalColor = ambientTerm + directLight + vec3(rim) * F0 + emissiveTerm;
    // ACES 近似柔和高光色调映射（防止强金属高光死白过曝）
    finalColor = finalColor / (finalColor + vec3(0.18)) * 1.15;

    outColor = vec4(clamp(finalColor, 0.0, 1.0), u_opacity);
}
`;
