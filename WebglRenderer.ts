class WebglRenderer {

	// webgl
	private _gl:WebGLRenderingContext;
	private _width:number = 0;
	private _height:number = 0;

	// image input
	private _textures:WebGLTexture[] = []; // <slotIndex> = texture ID

	// shader
	private _program:WebGLProgram;
	private _posAttributeIndex:number;
	private _uvAttributeIndex:number;

	// uniform
	private _uniformGlobalTime:WebGLUniformLocation;
	private _uniformResolution:WebGLUniformLocation;

	// quad
	private _quadVBO:WebGLBuffer;

	// control
	private _requestAnimationID:number;
	private _time:number = 0;

	/**
	 * Requires a HTMLCanvasElement and a shader program as a plain text string
	 *
	 * @param _canvas
	 * @param shader
	 * @param _animationLoop
	 */
	constructor(private _canvas:HTMLCanvasElement, shader:string, private _animationLoop:boolean = true) {
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
	public addImage(image:HTMLImageElement, slotIndex:number, clampToEdge:boolean = true):void {
		if (slotIndex >= 4) {
			console.log('ImageEffectRender: A maximum of 4 slots is available, slotIndex is out of bounds.');
		}

		if (!this._textures[slotIndex]) {
			this._textures[slotIndex] = this._gl.createTexture();
			this._gl.useProgram(this._program);
			this._gl.uniform1i(this._gl.getUniformLocation(this._program, 'iChannel' + slotIndex), slotIndex);
			this._gl.uniform2f(
				this._gl.getUniformLocation(this._program, 'iChannelResolution' + slotIndex),
				image.width,
				image.height,
			);
		}

		this._gl.bindTexture(this._gl.TEXTURE_2D, this._textures[slotIndex]);
		this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGB, this._gl.RGB, this._gl.UNSIGNED_BYTE, image);
		this._gl.texParameteri(
			this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_S, clampToEdge ? this._gl.CLAMP_TO_EDGE : this._gl.REPEAT,
		);
		this._gl.texParameteri(
			this._gl.TEXTURE_2D, this._gl.TEXTURE_WRAP_T, clampToEdge ? this._gl.CLAMP_TO_EDGE : this._gl.REPEAT,
		);
		this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.LINEAR);
		this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.LINEAR);
	}

	public play():void {
		if (!this._requestAnimationID) {
			this.draw(0);
		}
	}

	public stop():void {
		if (this._requestAnimationID) {
			window.cancelAnimationFrame(this._requestAnimationID);
			this._requestAnimationID = null;
		}
	}

	private draw(time:number):void {
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
		for (let slotIndex:number = 0; slotIndex < this._textures.length; ++slotIndex) {
			this._gl.activeTexture(this._gl.TEXTURE0 + slotIndex);
			this._gl.bindTexture(this._gl.TEXTURE_2D, this._textures[slotIndex]);
		}

		// render NDC quad
		this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._quadVBO);
		this._gl.enableVertexAttribArray(this._posAttributeIndex);
		this._gl.vertexAttribPointer(
			this._posAttributeIndex, 2, this._gl.FLOAT, false, 4 * 4, 0,
		); // 4 32-bit values = 4 4-byte values
		this._gl.enableVertexAttribArray(this._uvAttributeIndex);
		this._gl.vertexAttribPointer(this._uvAttributeIndex, 2, this._gl.FLOAT, false, 4 * 4, 2 * 4);

		this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);

		if (this._animationLoop) {
			this._requestAnimationID = window.requestAnimationFrame(time => this.draw(time));
		}
	}

	private compileShader(fsSource:string):void {
		this._program = this._gl.createProgram();

		const vs = this._gl.createShader(this._gl.VERTEX_SHADER);
		const fs = this._gl.createShader(this._gl.FRAGMENT_SHADER);

		// vertex shader
		const vsSource:string = `
            attribute vec2 aPos;
            attribute vec2 aUV;
            
            varying vec2 vUV0;
            
            void main(void) {
                vUV0 = aUV;
                gl_Position = vec4(aPos, 0.0, 1.0);
            }
        `;
		this._gl.shaderSource(vs, vsSource);
		this._gl.compileShader(vs);

		let success = this._gl.getShaderParameter(vs, this._gl.COMPILE_STATUS);
		if (!success) {
			console.error('ImageEffectRender: Vertex shader compilation failed:');
			console.error(this._gl.getShaderInfoLog(vs));
		}

		// fragment shader
		const fsMainSource:string = `
            #ifdef GL_ES
                precision highp float;
            #endif
            
            varying vec2 vUV0;
            
            uniform vec2 iResolution;
            uniform float iGlobalTime;
            uniform vec4 iMouse;
            
            uniform sampler2D iChannel0;
            uniform sampler2D iChannel1;
            uniform sampler2D iChannel2;
            uniform sampler2D iChannel3;
            
            uniform vec2 iChannelResolution0;
            uniform vec2 iChannelResolution1;
            uniform vec2 iChannelResolution2;
            uniform vec2 iChannelResolution3;
            
            void mainImage(out vec4, vec2);
            
            vec4 texture(sampler2D tex, vec2 uv)
            {
                return texture2D(tex, uv);
            }
            
            void main(void) {
                mainImage(gl_FragColor, gl_FragCoord.xy);
                gl_FragColor.a = 1.0; 
            }
        `;
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
		this._uvAttributeIndex  = this._gl.getAttribLocation(this._program, 'aUV');

		// get uniform locations
		this._gl.useProgram(this._program);
		this._uniformGlobalTime = this._gl.getUniformLocation(this._program, 'iGlobalTime');
		this._uniformResolution = this._gl.getUniformLocation(this._program, 'iResolution');
	}

	private generateNDCQuad():void {
		const vertices:Float32Array = new Float32Array([
			// pos  // uv
			-1, 1,  0, 1,
			-1, -1, 0, 0,
			1,  1,  1, 1,
			1, -1,  1, 0,
		]);
		this._quadVBO = this._gl.createBuffer();
		this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._quadVBO);
		this._gl.bufferData(this._gl.ARRAY_BUFFER, vertices, this._gl.STATIC_DRAW);
	}

	public destruct():void {
		for (let i:number = 0; i < this._textures.length; ++i) {
			this._gl.deleteTexture(this._textures[i]);
			this._textures[i] = null;
		}

		this._gl.deleteBuffer(this._quadVBO);
		this._quadVBO = null;

		this._gl.deleteProgram(this._program);
		this._program = null;

		this.stop();
	}
}

export default WebglRenderer;