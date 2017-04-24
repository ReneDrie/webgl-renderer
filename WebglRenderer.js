"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var WebglRenderer = (function () {
    /**
     * Requires a HTMLCanvasElement and a shader program as a plain text string
     *
     * @param _canvas
     * @param shader
     * @param _animationLoop
     */
    function WebglRenderer(_canvas, shader, _animationLoop) {
        if (_animationLoop === void 0) { _animationLoop = true; }
        this._canvas = _canvas;
        this._animationLoop = _animationLoop;
        this._width = 0;
        this._height = 0;
        // image input
        this._textures = []; // <slotIndex> = texture ID
        this._time = 0;
        this._gl = this._canvas.getContext('webgl') || this._canvas.getContext('experimental-webgl');
        if (!this._gl) {
            console.error('ImageEffectRender: Failed to request a 3D context, aborting...');
            return;
        }
        // one-time setup
        this.compileShader(shader);
        this.generateNDCQuad();
        // gl configuration
        this._gl.clearColor(0, 0, 0, 1);
        this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
        this._width = this._canvas.width;
        this._height = this._canvas.height;
    }
    /**
     * Add Image to the GL, This can be an HTMLImageElement or a rendered Canvas
     *
     * @param image
     * @param slotIndex
     * @param clampToEdge
     */
    WebglRenderer.prototype.addImage = function (image, slotIndex, clampToEdge) {
        if (clampToEdge === void 0) { clampToEdge = true; }
        if (slotIndex >= 4) {
            console.log('ImageEffectRender: A maximum of 4 slots is available, slotIndex is out of bounds.');
        }
        if (!this._textures[slotIndex]) {
            this._textures[slotIndex] = this._gl.createTexture();
            this._gl.useProgram(this._program);
            this._gl.uniform1i(this._gl.getUniformLocation(this._program, 'iChannel' + slotIndex), slotIndex);
            this._gl.uniform2f(this._gl.getUniformLocation(this._program, 'iChannelResolution' + slotIndex), image.width, image.height);
        }
        this._gl.bindTexture(this._gl.TEXTURE_2D, this._textures[slotIndex]);
        this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGB, this._gl.RGB, this._gl.UNSIGNED_BYTE, image);
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, clampToEdge ? this._gl.CLAMP_TO_EDGE : this._gl.REPEAT);
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, clampToEdge ? this._gl.CLAMP_TO_EDGE : this._gl.REPEAT);
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.LINEAR);
        this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.LINEAR);
    };
    WebglRenderer.prototype.play = function () {
        if (!this._requestAnimationID) {
            this.draw(0);
        }
    };
    WebglRenderer.prototype.stop = function () {
        if (this._requestAnimationID) {
            window.cancelAnimationFrame(this._requestAnimationID);
            this._requestAnimationID = null;
        }
    };
    WebglRenderer.prototype.draw = function (time) {
        var _this = this;
        this._time = time / 1000;
        // determine if screen has been resized. If so, adjust viewport
        if (this._canvas.width !== this._width || this._canvas.height !== this._height) {
            this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
            this._width = this._canvas.width;
            this._height = this._canvas.height;
        }
        // clear
        this._gl.clear(this._gl.COLOR_BUFFER_BIT);
        this._gl.useProgram(this._program);
        // global uniforms
        this._gl.uniform1f(this._uniformGlobalTime, this._time);
        this._gl.uniform2f(this._uniformResolution, this._canvas.width, this._canvas.height);
        // texture/channel uniforms
        for (var slotIndex = 0; slotIndex < this._textures.length; ++slotIndex) {
            this._gl.activeTexture(this._gl.TEXTURE0 + slotIndex);
            this._gl.bindTexture(this._gl.TEXTURE_2D, this._textures[slotIndex]);
        }
        // render NDC quad
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._quadVBO);
        this._gl.enableVertexAttribArray(this._posAttributeIndex);
        this._gl.vertexAttribPointer(this._posAttributeIndex, 2, this._gl.FLOAT, false, 4 * 4, 0); // 4 32-bit values = 4 4-byte values
        this._gl.enableVertexAttribArray(this._uvAttributeIndex);
        this._gl.vertexAttribPointer(this._uvAttributeIndex, 2, this._gl.FLOAT, false, 4 * 4, 2 * 4);
        this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);
        if (this._animationLoop) {
            this._requestAnimationID = window.requestAnimationFrame(function (time) { return _this.draw(time); });
        }
    };
    WebglRenderer.prototype.compileShader = function (fsSource) {
        this._program = this._gl.createProgram();
        var vs = this._gl.createShader(this._gl.VERTEX_SHADER);
        var fs = this._gl.createShader(this._gl.FRAGMENT_SHADER);
        // vertex shader
        var vsSource = "\n            attribute vec2 aPos;\n            attribute vec2 aUV;\n            \n            varying vec2 vUV0;\n            \n            void main(void) {\n                vUV0 = aUV;\n                gl_Position = vec4(aPos, 0.0, 1.0);\n            }\n        ";
        this._gl.shaderSource(vs, vsSource);
        this._gl.compileShader(vs);
        var success = this._gl.getShaderParameter(vs, this._gl.COMPILE_STATUS);
        if (!success) {
            console.error('ImageEffectRender: Vertex shader compilation failed:');
            console.error(this._gl.getShaderInfoLog(vs));
        }
        // fragment shader
        var fsMainSource = "\n            #ifdef GL_ES\n                precision highp float;\n            #endif\n            \n            varying vec2 vUV0;\n            \n            uniform vec2 iResolution;\n            uniform float iGlobalTime;\n            uniform vec4 iMouse;\n            \n            uniform sampler2D iChannel0;\n            uniform sampler2D iChannel1;\n            uniform sampler2D iChannel2;\n            uniform sampler2D iChannel3;\n            \n            uniform vec2 iChannelResolution0;\n            uniform vec2 iChannelResolution1;\n            uniform vec2 iChannelResolution2;\n            uniform vec2 iChannelResolution3;\n            \n            void mainImage(out vec4, vec2);\n            \n            vec4 texture(sampler2D tex, vec2 uv)\n            {\n                return texture2D(tex, uv);\n            }\n            \n            void main(void) {\n                mainImage(gl_FragColor, gl_FragCoord.xy);\n                gl_FragColor.a = 1.0; \n            }\n        ";
        fsSource = fsMainSource + fsSource;
        this._gl.shaderSource(fs, fsSource);
        this._gl.compileShader(fs);
        success = this._gl.getShaderParameter(fs, this._gl.COMPILE_STATUS);
        if (!success) {
            console.error('ImageEffectRender: Shader compilation failed:');
            console.error(this._gl.getShaderInfoLog(fs));
        }
        // link shaders
        this._gl.attachShader(this._program, vs);
        this._gl.attachShader(this._program, fs);
        this._gl.linkProgram(this._program);
        success = this._gl.getProgramParameter(this._program, this._gl.LINK_STATUS);
        if (!success) {
            console.error('ImageEffectRender: Program linking failed:');
            console.error(this._gl.getProgramInfoLog(this._program));
        }
        // get attribute locations
        this._posAttributeIndex = this._gl.getAttribLocation(this._program, 'aPos');
        this._uvAttributeIndex = this._gl.getAttribLocation(this._program, 'aUV');
        // get uniform locations
        this._gl.useProgram(this._program);
        this._uniformGlobalTime = this._gl.getUniformLocation(this._program, 'iGlobalTime');
        this._uniformResolution = this._gl.getUniformLocation(this._program, 'iResolution');
    };
    WebglRenderer.prototype.generateNDCQuad = function () {
        var vertices = new Float32Array([
            // pos  // uv
            -1, 1, 0, 1,
            -1, -1, 0, 0,
            1, 1, 1, 1,
            1, -1, 1, 0,
        ]);
        this._quadVBO = this._gl.createBuffer();
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._quadVBO);
        this._gl.bufferData(this._gl.ARRAY_BUFFER, vertices, this._gl.STATIC_DRAW);
    };
    WebglRenderer.prototype.destruct = function () {
        for (var i = 0; i < this._textures.length; ++i) {
            this._gl.deleteTexture(this._textures[i]);
            this._textures[i] = null;
        }
        this._gl.deleteBuffer(this._quadVBO);
        this._quadVBO = null;
        this._gl.deleteProgram(this._program);
        this._program = null;
        this.stop();
    };
    return WebglRenderer;
}());
exports.default = WebglRenderer;
