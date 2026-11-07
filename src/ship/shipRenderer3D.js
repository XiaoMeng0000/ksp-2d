'use strict';

// WebGL2 3D 飞船渲染器（v3.1）
// 职责：管理离屏 WebGL2 上下文、编译 PBR 航天材质着色器、缓存复合几何与 .obj 网格、
// 自动烘焙 128x128 零件 3D 缩略图（供 VAB 左侧零件网格使用）、
// 执行每帧 3D 飞船绘制（含恒星动态主光、行星日食可见度衰减、选中高亮与半透明对称预览）。

import { createGLContext } from '../glCore/context.js';
import { createMesh, drawMesh, destroyMesh } from '../glCore/mesh.js';
import { createProgram, setUniforms, destroyProgram } from '../glCore/shader.js';
import {
    multiply4,
    normalMatrixFromModel,
    modelMatrixFromPosRotY,
    perspective,
    lookAt
} from './shipMath3D.js';
import { getPartType } from '../config/entities/partTypes.js';
import { PART_LAB_CONFIG } from '../config/gameplay/partLabConfig.js';
import { buildPartGeometry, getPartTypeMetrics } from './partPrimitives.js';
import { fetchObjGeometry } from './objLoader.js';
import { loadKspPart, KSP_PART_VERTEX_LAYOUT, KSP_PART_FLOATS_PER_VERTEX } from './kspPartLoader.js';
import { textureManager } from '../graphics/textureManager.js';
import { SHIP_VERT, SHIP_FRAG } from './shaders/shipShaders.js';
import { KSP_VERT, KSP_FRAG } from './shaders/kspPartShaders.js';

export class ShipRenderer3D {
    constructor(mainCanvas) {
        this.mainCanvas = mainCanvas;
        this.glCanvas = document.createElement('canvas');
        this.gl = null;
        this.shader = null;
        this._meshes = new Map();
        this._thumbnails = new Map();
        this._objLoading = new Set();
        this._onThumbUpdated = null;
        this._lost = false;
        this._failed = false;
        this._warned = false;

        // KSP2 贴图资产管线（与程序化部件并行的第二套管线）
        this.kspShader = null;
        this._kspBundles = new Map();     // typeId → { submeshes: [{mesh, tex, material}], bounds }
        this._kspLoading = new Set();
        this._glTextures = new Map();     // url → WebGLTexture

        this._lightOn = true;
        this._sunAzimuthRad = 0.65;
        this._sunElevationRad = 0.52;
        this._sunVisibility = 1.0;

        this._initGL();
    }

    _initGL() {
        try {
            this.gl = createGLContext(this.glCanvas, { alpha: true, antialias: true });
            this.shader = createProgram(this.gl, {
                vertex: SHIP_VERT,
                fragment: SHIP_FRAG,
                name: 'ship3d'
            });
            this.kspShader = createProgram(this.gl, {
                vertex: KSP_VERT,
                fragment: KSP_FRAG,
                name: 'kspPart3d'
            });
            this.glCanvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault();
                this._lost = true;
                this._warnOnce('WebGL2 上下文丢失，3D 飞船视图暂停渲染');
            });
        } catch (err) {
            this._failed = true;
            this._warnOnce('WebGL2 初始化失败: ' + (err && err.message ? err.message : String(err)));
        }
    }

    _warnOnce(msg) {
        if (this._warned) return;
        this._warned = true;
        console.warn('[ShipRenderer3D] ' + msg);
    }

    setOnThumbnailUpdated(cb) {
        this._onThumbUpdated = typeof cb === 'function' ? cb : null;
    }

    isReady() {
        if (this._failed || this._lost || !this.gl || !this.shader) return false;
        if (typeof this.gl.isContextLost === 'function' && this.gl.isContextLost()) {
            this._lost = true;
            return false;
        }
        return true;
    }

    setLightingEnabled(on) {
        this._lightOn = !!on;
    }

    isLightingEnabled() {
        return this._lightOn;
    }

    setSunAzimuthDeg(deg) {
        this._sunAzimuthRad = (Number(deg) || 0) * Math.PI / 180;
    }

    getSunAzimuthDeg() {
        return Math.round(this._sunAzimuthRad * 180 / Math.PI);
    }

    setSunVisibility(val) {
        this._sunVisibility = Math.max(0, Math.min(1, Number(val)));
    }

    getSunVisibility() {
        return this._sunVisibility;
    }

    getLightDirection() {
        const ce = Math.cos(this._sunElevationRad);
        const se = Math.sin(this._sunElevationRad);
        return [
            ce * Math.sin(this._sunAzimuthRad),
            se,
            ce * Math.cos(this._sunAzimuthRad)
        ];
    }

    _syncSize() {
        if (!this.mainCanvas) return;
        const w = Math.max(1, this.mainCanvas.width);
        const h = Math.max(1, this.mainCanvas.height);
        if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
            this.glCanvas.width = w;
            this.glCanvas.height = h;
        }
    }

    _buildMeshFromDesc(desc) {
        return createMesh(this.gl, {
            layout: desc.layout,
            vertices: desc.vertices,
            indices: desc.indices,
            vertexCount: desc.vertexCount,
            attributeLocations: {
                POSITION: this.shader.attribs.aPosition,
                NORMAL:   this.shader.attribs.aNormal,
                COLOR:    this.shader.attribs.aColor,
                MATERIAL: this.shader.attribs.aMaterial
            }
        });
    }

    /**
     * 上传一张图片为 WebGL 纹理（按 MIPMAP 采样，贴图 URL 级缓存）。
     * @param {string} url
     * @returns {WebGLTexture|null}
     */
    _getGLTexture(url) {
        if (!url) return null;
        const cached = this._glTextures.get(url);
        if (cached) return cached;

        const img = textureManager.get('lazy:' + url);
        if (!img) {
            // 首次访问：发起懒加载，图片就绪后下一帧自然走贴图分支
            textureManager.loadLazy(url);
            return null;
        }

        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this._glTextures.set(url, tex);
        return tex;
    }

    /**
     * 预取 KSP2 部件的全部贴图（异步，不阻塞首帧）。
     */
    _prefetchKspTextures(bundle) {
        for (const sm of bundle.submeshes) {
            const info = sm.materialInfo;
            if (!info) continue;
            [info.diffuse, info.normal, info.metallic, info.ao, info.emissive]
                .filter(Boolean)
                .forEach((url) => textureManager.loadLazy(url));
        }
    }

    /**
     * 加载（或取缓存的）KSP2 部件贴图网格包。
     * @param {object} partType
     * @returns {object|null} { submeshes: [...], bounds }
     */
    _getKspBundle(partType) {
        if (!partType || !this.isReady()) return null;
        const ksp = partType.ksp2;
        if (!ksp) return null;

        const cached = this._kspBundles.get(partType.id);
        if (cached) return cached;

        if (!this._kspLoading.has(partType.id)) {
            this._kspLoading.add(partType.id);
            loadKspPart(ksp.dir, ksp.obj, ksp.mtl).then((parsed) => {
                if (!parsed || !this.isReady()) return;
                const submeshes = [];
                for (const sm of parsed.submeshes) {
                    const mesh = createMesh(this.gl, {
                        layout: KSP_PART_VERTEX_LAYOUT,
                        vertices: sm.vertices,
                        indices: sm.indices,
                        vertexCount: sm.vertexCount,
                        attributeLocations: {
                            POSITION: this.kspShader.attribs.aPosition,
                            NORMAL:   this.kspShader.attribs.aNormal,
                            UV:       this.kspShader.attribs.aUV
                        }
                    });
                    submeshes.push({
                        mesh,
                        materialInfo: sm.materialInfo,
                        materialName: sm.material
                    });
                }
                const bundle = { submeshes, bounds: parsed.bounds, textured: true };
                this._kspBundles.set(partType.id, bundle);
                this._prefetchKspTextures(bundle);

                // 资产就绪后重拍缩略图
                this._thumbnails.delete(partType.id);
                const newUrl = this.getPartThumbnail(partType.id);
                if (this._onThumbUpdated && newUrl) {
                    this._onThumbUpdated(partType.id, newUrl);
                }
            });
        }

        return null;
    }

    /**
     * 绘制一个 KSP2 贴图部件（多子网格，每子网格绑定自身材质贴图）。
     */
    _drawKspPart(bundle, model, viewProj, eye, lightDir, tint, opacity) {
        const gl = this.gl;
        const normalMat = normalMatrixFromModel(model);

        for (const sm of bundle.submeshes) {
            const info = sm.materialInfo || {};
            const texDiffuse = this._getGLTexture(info.diffuse);
            const texNormal = this._getGLTexture(info.normal);
            const texMetallic = this._getGLTexture(info.metallic);
            const texAO = this._getGLTexture(info.ao);
            const texEmissive = this._getGLTexture(info.emissive);

            // 未就绪的贴图用 1x1 透明/中性贴图占位会污染观感，
            // 这里直接让首帧走「无贴图」分支（uniform 为 0），等待下一帧贴图就绪
            gl.useProgram(this.kspShader.program);
            if (texDiffuse) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texDiffuse); }
            if (texNormal) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNormal); }
            if (texMetallic) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texMetallic); }
            if (texAO) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, texAO); }
            if (texEmissive) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, texEmissive); }

            setUniforms(gl, this.kspShader, {
                u_modelMatrix: model,
                u_normalMatrix: normalMat,
                u_viewProjMatrix: viewProj,
                u_lightDir: lightDir,
                u_cameraPos: eye,
                u_lightOn: this._lightOn ? 1.0 : 0.0,
                u_sunVisibility: this._sunVisibility,
                u_ambient: PART_LAB_CONFIG.lighting.ambient,
                u_diffuse: PART_LAB_CONFIG.lighting.diffuse,
                u_specular: PART_LAB_CONFIG.lighting.specular,
                u_tintColor: tint,
                u_opacity: opacity,
                // 注意：sampler2D 不能用 setUniforms 传数字 —— 其内部按类型走 uniform1f，
                // 对 sampler 会触发 GL_INVALID_OPERATION(1282)。贴图槽位统一在下方手动 uniform1i 写入。
                u_hasDiffuse: texDiffuse ? 1.0 : 0.0,
                u_hasNormal: texNormal ? 1.0 : 0.0,
                u_hasMetallic: texMetallic ? 1.0 : 0.0,
                u_hasAO: texAO ? 1.0 : 0.0,
                u_hasEmissive: texEmissive ? 1.0 : 0.0,
                u_normalStrength: 1.0,
                u_emissiveStrength: 1.0
            });

            // 贴图槽位固定绑定到 0~4 号纹理单元（sampler 只能走 uniform1i）
            const u = this.kspShader.uniforms;
            if (u.u_diffuseMap) gl.uniform1i(u.u_diffuseMap, 0);
            if (u.u_normalMap) gl.uniform1i(u.u_normalMap, 1);
            if (u.u_metallicMap) gl.uniform1i(u.u_metallicMap, 2);
            if (u.u_aoMap) gl.uniform1i(u.u_aoMap, 3);
            if (u.u_emissiveMap) gl.uniform1i(u.u_emissiveMap, 4);

            drawMesh(gl, sm.mesh);
        }
    }

    /**
     * 统一入口：绘制单个部件（自动分流到程序化管线或 KSP2 贴图管线）。
     * @returns {boolean} 是否实际绘制
     */
    _drawPart(type, model, viewProj, eye, lightDir, tint, opacity) {
        if (type.ksp2) {
            const bundle = this._getKspBundle(type);
            if (!bundle) return false;
            this._drawKspPart(bundle, model, viewProj, eye, lightDir, tint, opacity);
            return true;
        }
        const mesh = this._getMesh(type);
        if (!mesh) return false;
        const normalMat = normalMatrixFromModel(model);
        const cfg = PART_LAB_CONFIG.lighting;
        setUniforms(this.gl, this.shader, {
            u_modelMatrix: model,
            u_normalMatrix: normalMat,
            u_viewProjMatrix: viewProj,
            u_lightDir: lightDir,
            u_cameraPos: eye,
            u_lightOn: this._lightOn ? 1.0 : 0.0,
            u_sunVisibility: this._sunVisibility,
            u_ambient: cfg.ambient,
            u_diffuse: cfg.diffuse,
            u_specular: cfg.specular,
            u_shininess: cfg.shininess,
            u_tintColor: tint,
            u_opacity: opacity
        });
        drawMesh(this.gl, mesh);
        return true;
    }

    _getMesh(partType) {
        if (!partType || !this.isReady()) return null;
        if (this._meshes.has(partType.id)) {
            return this._meshes.get(partType.id);
        }

        const desc = buildPartGeometry(partType, PART_LAB_CONFIG.mesh);
        const mesh = this._buildMeshFromDesc(desc);
        this._meshes.set(partType.id, mesh);

        const modelPath = partType.visual && partType.visual.modelPath;
        if (modelPath && !this._objLoading.has(partType.id)) {
            this._objLoading.add(partType.id);
            fetchObjGeometry(modelPath).then((objDesc) => {
                if (!objDesc || !objDesc.vertexCount || !this.isReady()) return;
                const oldMesh = this._meshes.get(partType.id);
                const newMesh = this._buildMeshFromDesc(objDesc);
                this._meshes.set(partType.id, newMesh);
                if (oldMesh) {
                    destroyMesh(this.gl, oldMesh);
                }
                // 重新烘焙该部件的 3D 缩略图
                this._thumbnails.delete(partType.id);
                const newUrl = this.getPartThumbnail(partType.id);
                if (this._onThumbUpdated && newUrl) {
                    this._onThumbUpdated(partType.id, newUrl);
                }
            });
        }

        return mesh;
    }

    /**
     * 为指定部件离屏渲染一张 128x128 带金属光照的斜 35° 3D 缩略图（DataURL），供 VAB 零件网格使用。
     * @param {string} typeId
     * @returns {string|null}
     */
    getPartThumbnail(typeId) {
        if (this._thumbnails.has(typeId)) {
            return this._thumbnails.get(typeId);
        }
        const type = getPartType(typeId);
        if (!type || !this.isReady()) return null;

        // KSP2 贴图部件：先确保网格包已加载
        if (type.ksp2) {
            const bundle = this._getKspBundle(type);
            if (!bundle) return null;
        } else {
            const mesh = this._getMesh(type);
            if (!mesh) return null;
        }

        const gl = this.gl;
        const size = 128;
        const prevW = this.glCanvas.width;
        const prevH = this.glCanvas.height;

        this.glCanvas.width = size;
        this.glCanvas.height = size;
        gl.viewport(0, 0, size, size);
        gl.clearColor(0, 0, 0, 0);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const metrics = getPartTypeMetrics(type);
        const span = Math.max(metrics.halfHeight * 2.1, metrics.radius * 2.35, 0.9);
        const fovRad = 34 * Math.PI / 180;
        const dist = (0.5 * span / Math.tan(fovRad / 2)) * 1.38;

        const eye = [
            dist * Math.sin(0.55) * Math.cos(0.32),
            dist * Math.sin(0.32),
            dist * Math.cos(0.55) * Math.cos(0.32)
        ];
        const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
        const proj = perspective(fovRad, 1.0, 0.05, 50, 0.5);
        const viewProj = multiply4(proj, view);
        const model = modelMatrixFromPosRotY([0, 0, 0], -0.25);

        // 统一分流：程序化部件 / KSP2 贴图部件
        this._drawPart(type, model, viewProj, eye, [0.58, 0.62, 0.52], [0, 0, 0, 0], 1.0);

        // 复制到独立 2D 小画布转 DataURL
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = size;
        thumbCanvas.height = size;
        const tctx = thumbCanvas.getContext('2d');
        tctx.drawImage(this.glCanvas, 0, 0);
        const dataUrl = thumbCanvas.toDataURL('image/png');

        // 恢复主画布尺寸
        if (prevW > 0 && prevH > 0) {
            this.glCanvas.width = prevW;
            this.glCanvas.height = prevH;
        }

        this._thumbnails.set(typeId, dataUrl);
        return dataUrl;
    }

    /**
     * 渲染飞船装配树与可选的拖拽半透明预览体。
     */
    render(design, camera, interactionState = {}) {
        if (!this.isReady() || !design || !Array.isArray(design.parts)) return false;

        const gl = this.gl;
        const cfg = PART_LAB_CONFIG.lighting;
        this._syncSize();

        gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const view = camera.getViewMatrix();
        const aspect = this.glCanvas.width / Math.max(1, this.glCanvas.height);
        const proj = camera.getProjectionMatrix(aspect);
        const viewProj = multiply4(proj, view);
        const eye = camera.getPosition();
        const lightDir = this.getLightDirection();

        const selectedSet = interactionState.selectedPartIds || null;
        const hoveredId = interactionState.hoveredPartId || null;

        gl.disable(gl.BLEND);
        gl.depthMask(true);

        for (const part of design.parts) {
            const type = getPartType(part.typeId);
            if (!type) continue;

            const model = modelMatrixFromPosRotY(part.position, part.rotationY || 0);

            let tint = [0, 0, 0, 0];
            if (selectedSet && selectedSet.has(part.id)) {
                tint = [0.32, 0.84, 1.0, 0.35];
            } else if (hoveredId === part.id) {
                tint = [1.0, 0.88, 0.42, 0.24];
            }

            this._drawPart(type, model, viewProj, eye, lightDir, tint, 1.0);
        }

        const ghostParts = interactionState.ghostParts;
        if (Array.isArray(ghostParts) && ghostParts.length > 0) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false);

            for (const ghost of ghostParts) {
                const type = getPartType(ghost.typeId);
                if (!type) continue;

                const model = modelMatrixFromPosRotY(ghost.position, ghost.rotationY || 0);
                const tint = ghost.valid
                    ? [0.25, 0.96, 0.48, 0.42]
                    : [1.0, 0.28, 0.28, 0.50];

                this._drawPart(type, model, viewProj, eye, lightDir, tint, 0.72);
            }

            gl.depthMask(true);
            gl.disable(gl.BLEND);
        }

        return true;
    }

    dispose() {
        if (!this.gl) return;
        for (const mesh of this._meshes.values()) {
            destroyMesh(this.gl, mesh);
        }
        this._meshes.clear();
        this._thumbnails.clear();
        if (this.shader) {
            destroyProgram(this.gl, this.shader);
            this.shader = null;
        }
    }
}
