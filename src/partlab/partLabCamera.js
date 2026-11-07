'use strict';

// 部件装配车间 - 3D 轨道球相机（支持旋转、垂直平移焦点、指数滚轮缩放、自适应取景与视口中心偏移）

import { PART_LAB_CONFIG } from '../config/gameplay/partLabConfig.js';
import { perspective, lookAt, multiply4 } from '../ship/shipMath3D.js';

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

export class PartLabCamera {
    constructor() {
        const cfg = PART_LAB_CONFIG.camera;
        this.fovYRad = (cfg.fovYDeg || 38) * Math.PI / 180;
        this.near = cfg.near || 0.1;
        this.far = cfg.far || 200;
        this.distance = cfg.distance || 9.5;
        this.theta = cfg.theta !== undefined ? cfg.theta : 0.42;
        this.phi = cfg.phi !== undefined ? cfg.phi : (Math.PI / 2 - 0.24);
        this.target = [0, -1.6, 0];
        this.centerXRatio = 0.49;
    }

    getFovYRad() {
        return this.fovYRad;
    }

    getTarget() {
        return [this.target[0], this.target[1], this.target[2]];
    }

    setCenterXRatio(ratio) {
        this.centerXRatio = clamp(Number(ratio) || 0.5, 0.25, 0.75);
    }

    getCenterXRatio() {
        return this.centerXRatio;
    }

    getPosition() {
        const sinPhi = Math.sin(this.phi);
        const cosPhi = Math.cos(this.phi);
        const sinTheta = Math.sin(this.theta);
        const cosTheta = Math.cos(this.theta);
        return [
            this.target[0] + this.distance * sinPhi * sinTheta,
            this.target[1] + this.distance * cosPhi,
            this.target[2] + this.distance * sinPhi * cosTheta
        ];
    }

    getViewMatrix() {
        return lookAt(this.getPosition(), this.target, [0, 1, 0]);
    }

    getProjectionMatrix(aspect) {
        return perspective(this.fovYRad, aspect, this.near, this.far, this.centerXRatio);
    }

    getViewProjMatrix(canvasW, canvasH) {
        const aspect = Math.max(1e-4, canvasW / Math.max(1, canvasH));
        return multiply4(this.getProjectionMatrix(aspect), this.getViewMatrix());
    }

    rotate(dxCssPx, dyCssPx) {
        const cfg = PART_LAB_CONFIG.camera;
        this.theta -= dxCssPx * cfg.rotateSpeed;
        this.phi = clamp(this.phi - dyCssPx * cfg.rotateSpeed, cfg.phiMin, cfg.phiMax);
    }

    panY(dyCssPx) {
        const cfg = PART_LAB_CONFIG.camera;
        const scale = this.distance * (cfg.panSpeed || 0.008) * 0.15;
        this.target[1] = clamp(this.target[1] + dyCssPx * scale, -25, 15);
    }

    zoomByWheel(event) {
        const cfg = PART_LAB_CONFIG.camera;
        const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? 100 : 1);
        const dy = (event.deltaY || 0) * unit;
        this.distance = clamp(
            this.distance * Math.exp(dy * cfg.zoomPerPixel),
            cfg.minDistance,
            cfg.maxDistance
        );
    }

    fitToBounds(bounds, resetAngles = false) {
        if (!bounds) return;
        const cfg = PART_LAB_CONFIG.camera;
        this.target = [0, bounds.centerY || 0, 0];
        const span = Math.max(bounds.height || 3.0, (bounds.maxRadius || 1.0) * 2.4);
        const idealDist = (0.5 * span / Math.tan(this.fovYRad / 2)) * 1.48;
        this.distance = clamp(idealDist, cfg.minDistance + 1.2, cfg.maxDistance);
        if (resetAngles) {
            this.theta = cfg.theta !== undefined ? cfg.theta : 0.42;
            this.phi = cfg.phi !== undefined ? cfg.phi : (Math.PI / 2 - 0.24);
        }
    }
}
