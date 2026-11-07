'use strict';

// KSP2 部件贴图 PBR 着色器（GLSL ES 3.00）
// 与 shipShaders.js（程序化航天材质）并行存在，专用于真实资产：
//   漫反射贴图（_MainTex / map_Kd）
//   法线贴图（_BumpMap / map_Bump，切线空间，用屏幕导数构造 cotangent frame，无需顶点切线）
//   金属/光滑度贴图（_MetallicGlossMap：R = metallic，A = smoothness）
//   AO 贴图（_OcclusionMap：G 通道）
//   自发光贴图（_EmissionMap / map_Ke）
// 光照模型：与 shipShaders 同一套 GGX + 双半球环境反射 + 恒星可见度（日食阴影）口径，便于两套资产混排。

export const KSP_VERT = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;

uniform mat4 u_modelMatrix;
uniform mat3 u_normalMatrix;
uniform mat4 u_viewProjMatrix;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;

void main() {
    vec4 world = u_modelMatrix * vec4(aPosition, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(u_normalMatrix * aNormal);
    vUV = aUV;
    gl_Position = u_viewProjMatrix * world;
}
`;

export const KSP_FRAG = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;

uniform vec3 u_lightDir;
uniform vec3 u_cameraPos;
uniform float u_lightOn;
uniform float u_sunVisibility;
uniform float u_ambient;
uniform float u_diffuse;
uniform float u_specular;
uniform vec4 u_tintColor;
uniform float u_opacity;

uniform sampler2D u_diffuseMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_metallicMap;
uniform sampler2D u_aoMap;
uniform sampler2D u_emissiveMap;

uniform float u_hasDiffuse;
uniform float u_hasNormal;
uniform float u_hasMetallic;
uniform float u_hasAO;
uniform float u_hasEmissive;
uniform float u_normalStrength;
uniform float u_emissiveStrength;

out vec4 outColor;

const float PI = 3.14159265359;

// 无顶点切线时，用屏幕空间导数构造切线基（Christian Schüler cotangent frame）
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
    vec3 dp1 = dFdx(p);
    vec3 dp2 = dFdy(p);
    vec2 duv1 = dFdx(uv);
    vec2 duv2 = dFdy(uv);

    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

    float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
    return mat3(T * invmax, B * invmax, N);
}

void main() {
    // ---- 基础色（sRGB 贴图 → 近似线性；无漫反射贴图时退回中性灰） ----
    vec3 albedo = u_hasDiffuse > 0.5
        ? pow(texture(u_diffuseMap, vUV).rgb, vec3(2.2))
        : vec3(0.72);
    albedo = mix(albedo, u_tintColor.rgb, u_tintColor.a);

    // ---- 法线 ----
    vec3 geomN = normalize(vNormal);
    vec3 n = geomN;
    if (u_hasNormal > 0.5) {
        vec3 tn = texture(u_normalMap, vUV).xyz * 2.0 - 1.0;
        tn.xy *= u_normalStrength;
        tn = normalize(tn);
        mat3 tbn = cotangentFrame(geomN, vWorldPos, vUV);
        n = normalize(tbn * tn);
    }

    // ---- 金属度 / 粗糙度（Unity _MetallicGlossMap: R=metallic, A=smoothness） ----
    float metallic = 0.0;
    float roughness = 0.55;
    if (u_hasMetallic > 0.5) {
        vec4 mg = texture(u_metallicMap, vUV);
        metallic = clamp(mg.r, 0.0, 1.0);
        roughness = clamp(1.0 - mg.a, 0.05, 1.0);
    }

    // ---- AO ----
    float ao = 1.0;
    if (u_hasAO > 0.5) {
        ao = clamp(texture(u_aoMap, vUV).g, 0.0, 1.0);
        ao = mix(1.0, ao, 0.85);
    }

    // ---- 自发光 ----
    vec3 emission = vec3(0.0);
    if (u_hasEmissive > 0.5) {
        vec3 e = texture(u_emissiveMap, vUV).rgb;
        emission = pow(e, vec3(2.2)) * u_emissiveStrength;
    }

    if (u_lightOn < 0.5) {
        outColor = vec4(clamp(albedo + emission, 0.0, 1.0), u_opacity);
        return;
    }

    vec3 l = normalize(u_lightDir);
    vec3 v = normalize(u_cameraPos - vWorldPos);
    vec3 h = normalize(l + v);

    float ndotl = max(dot(n, l), 0.0);
    float ndotv = max(dot(n, v), 0.001);
    float ndoth = max(dot(n, h), 0.0);
    float vdoth = max(dot(v, h), 0.0);

    // 菲涅尔（Schlick）
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdoth, 5.0);

    // GGX 法线分布
    float a = max(0.045, roughness * roughness);
    float a2 = a * a;
    float dDenom = (ndoth * ndoth * (a2 - 1.0) + 1.0);
    float D = a2 / max(PI * dDenom * dDenom, 1e-5);

    // Schlick-GGX 几何遮蔽
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float G = (ndotv / (ndotv * (1.0 - k) + k)) * (ndotl / (ndotl * (1.0 - k) + k));

    vec3 specBrdf = (D * G * F) / max(4.0 * ndotv * max(ndotl, 0.001), 0.001);

    vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);
    vec3 directLight = (kD * albedo * u_diffuse + specBrdf * u_specular * 1.5) * ndotl * u_sunVisibility;

    // 双半球环境反射（与程序化部件保持同一观感基准）
    vec3 rDir = reflect(-v, n);
    float skyFactor = clamp(rDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 envSky = vec3(0.62, 0.74, 0.92);
    vec3 envGround = vec3(0.18, 0.20, 0.25);
    float horizonBand = exp(-abs(rDir.y) * 4.5) * 0.30;
    vec3 envColor = mix(envGround, envSky, skyFactor) + vec3(0.85, 0.90, 1.0) * horizonBand;
    vec3 envSpec = envColor * F * (1.0 - roughness * 0.7) * (0.30 + 0.45 * u_sunVisibility);

    float hemi = u_ambient + 0.14 * (n.y * 0.5 + 0.5);
    vec3 ambientTerm = kD * albedo * hemi * ao + envSpec * ao;

    vec3 finalColor = ambientTerm + directLight + emission;
    // ACES 近似色调映射
    finalColor = finalColor / (finalColor + vec3(0.20)) * 1.18;

    outColor = vec4(clamp(finalColor, 0.0, 1.0), u_opacity);
}
`;
