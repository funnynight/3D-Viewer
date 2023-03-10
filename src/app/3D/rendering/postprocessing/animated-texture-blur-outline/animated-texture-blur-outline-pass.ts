import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, NoBlending, RepeatWrapping, RGBAFormat, ShaderMaterial, Texture, UniformsUtils, Vector2, WebGLRenderTarget } from 'three';
import type { WebGLRenderTargetOptions } from 'three/src/renderers/WebGLRenderTarget';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader';
import { createSeperableBlurMaterial } from './create-blur-material';
import type { IUniform } from 'three/src/renderers/shaders/UniformsLib';
import type { ProductConfiguratorService } from '../../../../shared/product-configurator.service';
import type { SelectedProductHighlighter } from '../../../selected-product-highlighter';
import { AnimatedTextureBlurOutlineOutputMode } from './animated-texture-blur-outline-output-mode';
import type { AnimatedTextureBlurOutlineOptions } from './animated-texture-blur-outline-options';
import type { ColorBlurOutlineTextures } from './color-blur-outline-textures';
import { isRenderTarget, isTexture } from '../../../3rd-party/three/types/is-threejs-type';
import { createOutlineMaterial } from './create-outline-material';

type TexturePropertyKey = 'hoverTexture' | 'selectedTexture';

// The blur shader code is adapted from three.js' OutlinePass:
// https://github.com/mrdoob/three.js/blob/dev/examples/jsm/postprocessing/OutlinePass.js
/**
 * This is an outline effect pass that creates an external outline by blurring the rendered object3D and comparing it to the sharp render.
 * It has different hover and selected textures for the colour and can tile the texture and animates the texture UV positions.
 *
 * As it uses textures the input textures can be single colour, gradients, animated gradients etc.
 * There are some examples in the `./outline-texture-generators/ folder that can be used.
 */
export class AnimatedTextureBlurOutlinePass extends Pass {
  /**
   * The hover mask material that renders the hovered object 3Ds into a single colour.
   */
  private readonly hoverMaskMaterial: MeshBasicMaterial;
  /**
   * The selected mask material that renders the selected object 3Ds into a single colour.
   */
  private readonly selectedMaskMaterial: MeshBasicMaterial;

  /**
   * The hover & selected masks.
   */
  private readonly maskRenderTarget: WebGLRenderTarget;
  /**
   * This is used for the edge outline of the material.
   */
  private blurHorizontalRenderTarget!: WebGLRenderTarget;

  /**
   * This is used for the edge outline of the material.
   */
  private blurVerticalRenderTarget!: WebGLRenderTarget;

  /**
   * This is used for the glowing part of the outline.
   * It's half the render size as {@link blurHorizontalRenderTarget}.
   */
  private blurHorizontalHalfRenderTarget!: WebGLRenderTarget;

  /**
   * This is used for the glowing part of the outline.
   * It's half the render size as {@link blurVerticalRenderTarget}.
   */
  private blurVerticalHalfRenderTarget2!: WebGLRenderTarget;

  /**
   * The shader material that combines all render targets to generate the final outline.
   */
  private outlineMaterial: ShaderMaterial;

  private blurMaterial!: ShaderMaterial;
  private blurHalfMaterial!: ShaderMaterial;

  private readonly blurHorizontalDirection = new Vector2(1, 0);
  private readonly blurVerticalDirection = new Vector2(0, 1);

  /**
   * Full screen quad to render the post process effects onto.
   */
  private readonly fsQuad: FullScreenQuad;
  private readonly copyUniforms: Record<string, IUniform>;
  private readonly materialCopy: ShaderMaterial;

  /**
   * We down sample the blur materials to increase the effect of the blur.
   * @private
   */
  private readonly downsampleResolution: number = 2;

  /**
   * The thickness ouf the outline part closest to 3D model.
   */
  private edgeThickness: number = 1;
  /**
   * The outer part of the edge.
   */
  private edgeGlow: number = 2;
  /**
   * Start texture U coordinate value.
   */
  private startU: number = 0;
  /**
   * How many times the texture repeats.
   */
  private tileCount: number = 1;
  /**
   * Should the outline texture be animated? From start to start + tileCount.
   */
  private animateOutline: boolean = true;
  /**
   * The duration of the animation in seconds.
   */
  private interval: number = 60;
  /**
   * Elapsed animation time in seconds.
   */
  private elapsed: number = 0;

  /**
   * We need a black colour, so it doesn't interfere with the RGB channels of the outline masks.
   */
  private readonly maskClearColor: Color = new Color(0x000000);
  /**
   * The application's mask clear colour that we'll restore after the outline is done.
   */
  private tempOldClearColor: Color = new Color();

  private hoverTexture: Texture | WebGLRenderTarget;
  private selectedTexture: Texture | WebGLRenderTarget;

  constructor(
    private productConfiguratorService: ProductConfiguratorService,
    private selectedProductHighlighter: SelectedProductHighlighter,
    resolution: Vector2,
    private scene: Scene,
    private camera: Camera,
    options: AnimatedTextureBlurOutlineOptions = {},
  ) {
    super();

    // We use additive blending and depthWrite = false to sum the outlines together.
    // Otherwise, the outlines would happen where the object 3Ds intersect instead of outlining each object3D individually.
    this.hoverMaskMaterial = new MeshBasicMaterial({
      color: 0xff0000,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.selectedMaskMaterial = new MeshBasicMaterial({
      color: 0x00ff00,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    const renderTargetOptions: WebGLRenderTargetOptions = {
      format: RGBAFormat,
    };

    this.setOptions(options);

    this.maskRenderTarget = new WebGLRenderTarget(resolution.x, resolution.y, renderTargetOptions);
    this.maskRenderTarget.texture.name = 'OutlinePass.mask';
    this.maskRenderTarget.texture.generateMipmaps = false;

    this.fsQuad = new FullScreenQuad();

    this.hoverTexture = this.createNewTexture();

    this.selectedTexture = this.createNewTexture();

    this.outlineMaterial = this.createOutlineMaterial(AnimatedTextureBlurOutlineOutputMode.Normal);
    this.initBlurRenderTargetsAndMaterials(resolution, renderTargetOptions);

    // copy material
    if (CopyShader === undefined) {
      console.error('THREE.OutlinePass relies on CopyShader');
    }

    this.copyUniforms = UniformsUtils.clone(CopyShader.uniforms);
    this.copyUniforms.opacity.value = 1.0;

    this.materialCopy = new ShaderMaterial({
      uniforms: this.copyUniforms,
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    this.productConfiguratorService.canvasResized.subscribe((size) => this.setSize(size.width, size.height));
  }

  setOptions(options: AnimatedTextureBlurOutlineOptions = {}): void {
    this.edgeThickness = options.edgeThickness ?? this.edgeThickness;
    this.edgeGlow = options.edgeGlow ?? this.edgeThickness;
    this.startU = options.startU ?? this.startU;
    this.tileCount = options.tileCount ?? this.tileCount;

    this.animateOutline = options.animateOutline ?? this.animateOutline;

    if (typeof options.animationInterval !== 'undefined') {
      // Convert from milliseconds to seconds.
      this.interval = options.animationInterval / 1000;
    }

    if (!this.outlineMaterial) {
      return;
    }

    // TODO: Add dynamic properties for edgeThickness, edgeGlow
    this.outlineMaterial.uniforms.tileCount.value = this.tileCount;
    if (!this.animateOutline) {
      this.elapsed = 0;
      this.outlineMaterial.uniforms.startU.value = this.startU;
    }
  }

  setSize(width: number, height: number): void {
    this.maskRenderTarget.setSize(width, height);

    let resX = Math.round(width / this.downsampleResolution);
    let resY = Math.round(height / this.downsampleResolution);

    this.blurHorizontalRenderTarget.setSize(resX, resY);
    this.blurMaterial.uniforms.texSize.value.set(resX, resY);

    resX = Math.round(resX / 2);
    resY = Math.round(resY / 2);

    this.blurHorizontalHalfRenderTarget.setSize(resX, resY);
    this.blurHalfMaterial.uniforms.texSize.value.set(resX, resY);
  }

  setColors(colors: ColorBlurOutlineTextures): void {
    if (colors.hover) {
      this.setTexture('hoverTexture', colors.hover);
    }
    if (colors.selected) {
      this.setTexture('selectedTexture', colors.selected);
    }
  }

  /**
   * A way to just set needsUpdate = true.
   */
  updateTexture(texture: 'hover' | 'selected'): void {
    if (texture === 'hover' && isTexture(this.hoverTexture)) {
      this.hoverTexture.needsUpdate = true;
    } else if (texture === 'selected' && isTexture(this.selectedTexture)) {
      this.selectedTexture.needsUpdate = true;
    }
  }

  /**
   * Set the hover or selected texture with either an image or a render target.
   */
  private setTexture(key: TexturePropertyKey, image: HTMLImageElement | HTMLCanvasElement | WebGLRenderTarget): void {
    if (isRenderTarget(image)) {
      this.setTextureRenderTarget(key, image as WebGLRenderTarget);
    } else {
      this.setTextureTexture(key, image as HTMLImageElement | HTMLCanvasElement);
    }
  }

  private setTextureRenderTarget(key: TexturePropertyKey, renderTarget: WebGLRenderTarget): void {
    if (this[key] === renderTarget) {
      return;
    }

    this[key] = renderTarget;
    this.outlineMaterial.uniforms[key].value = renderTarget.texture;
  }

  private setTextureTexture(key: TexturePropertyKey, image: HTMLImageElement | HTMLCanvasElement): void {
    let texture = this[key];
    if (isRenderTarget(texture)) {
      texture = this.createAndSetTexture(key);
    } else if (isTexture(texture)) {
      if (texture.image) {
        const [oldWidth, oldHeight] = this.getTextureDimensions(texture.image);
        const [newWidth, newHeight] = this.getTextureDimensions(image);

        if (oldWidth !== newWidth || oldHeight !== newHeight) {
          texture = this.createAndSetTexture(key);
        }
      }

      texture.image = image;
      texture.needsUpdate = true;
    }
  }

  private createNewTexture(): Texture {
    const texture = new Texture();
    texture.wrapS = RepeatWrapping;
    return texture;
  }

  private createAndSetTexture(key: TexturePropertyKey): Texture {
    const texture = this.createNewTexture();
    this.outlineMaterial.uniforms[key].value = texture;
    this[key] = texture;
    return texture;
  }

  private getTextureDimensions(image: HTMLImageElement | HTMLCanvasElement | undefined): [width: number, height: number] {
    if (!image) {
      return [0, 0];
    }

    if (image.nodeName.toLowerCase() === 'canvas') {
      return [image.width, image.height];
    }

    return [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight];
  }

  setOutputMode(mode: AnimatedTextureBlurOutlineOutputMode): void {
    this.outlineMaterial.dispose();
    this.outlineMaterial = this.createOutlineMaterial(mode);
  }

  private initBlurRenderTargetsAndMaterials(resolution: Vector2, renderTargetOptions: WebGLRenderTargetOptions): void {
    let resX = Math.round(resolution.x / this.downsampleResolution);
    let resY = Math.round(resolution.y / this.downsampleResolution);

    this.blurHorizontalRenderTarget = new WebGLRenderTarget(resX, resY, renderTargetOptions);
    this.blurHorizontalRenderTarget.texture.name = 'OutlinePass.blur';
    this.blurHorizontalRenderTarget.texture.generateMipmaps = false;

    this.blurVerticalRenderTarget = new WebGLRenderTarget(resX, resY, renderTargetOptions);
    this.blurVerticalRenderTarget.texture.name = 'OutlinePass.blur2';
    this.blurVerticalRenderTarget.texture.generateMipmaps = false;

    this.blurMaterial = createSeperableBlurMaterial(this.edgeThickness);
    this.blurMaterial.uniforms.texSize.value.set(resX, resY);
    this.blurMaterial.uniforms.kernelRadius.value = 1;

    resX = Math.round(resX / 2);
    resY = Math.round(resY / 2);

    this.blurHorizontalHalfRenderTarget = new WebGLRenderTarget(resX, resY, renderTargetOptions);
    this.blurHorizontalHalfRenderTarget.texture.name = 'OutlinePass.blur.half';
    this.blurHorizontalHalfRenderTarget.texture.generateMipmaps = false;

    this.blurVerticalHalfRenderTarget2 = new WebGLRenderTarget(resX, resY, renderTargetOptions);
    this.blurVerticalHalfRenderTarget2.texture.name = 'OutlinePass.blur.half2';
    this.blurVerticalHalfRenderTarget2.texture.generateMipmaps = false;

    this.blurHalfMaterial = createSeperableBlurMaterial(this.edgeGlow);
    this.blurHalfMaterial.uniforms.texSize.value.set(resX, resY);
    this.blurHalfMaterial.uniforms.kernelRadius.value = this.edgeGlow;
  }

  public shouldRenderOutline(): boolean {
    return this.selectedProductHighlighter.isAnyProductHighlighted();
  }

  public render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.elapsed = (this.elapsed + deltaTime) % this.interval;
    this.renderOutline(renderer, readBuffer);

    if (maskActive) {
      renderer.state.buffers.stencil.setTest(true);
    }

    if (this.renderToScreen) {
      this.fsQuad.material = this.materialCopy;
      this.copyUniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    }
  }

  private renderOutline(renderer: WebGLRenderer, readBuffer: WebGLRenderTarget): void {
    if (!this.shouldRenderOutline()) {
      return;
    }

    const oldAutoClear = renderer.autoClear;
    const oldClearAlpha = renderer.getClearAlpha();
    const oldClearColor = renderer.getClearColor(this.tempOldClearColor);
    renderer.setClearColor(this.maskClearColor, 0);
    // Since we're rendering multiple times to a render target we don't want to auto clear.
    renderer.autoClear = false;
    this.renderMaskTexture(renderer);
    this.renderBlurTexture(renderer);
    this.renderBlurHalfTexture(renderer);

    // This adds the outline material on top of the previous render.
    this.fsQuad.material = this.outlineMaterial;
    this.outlineMaterial.uniforms.maskTexture.value = this.maskRenderTarget.texture;
    this.outlineMaterial.uniforms.blurTexture.value = this.blurVerticalRenderTarget.texture;
    this.outlineMaterial.uniforms.blurHalfTexture.value = this.blurVerticalHalfRenderTarget2.texture;

    if (this.animateOutline) {
      const progress = this.elapsed / this.interval;
      this.outlineMaterial.uniforms.startU.value = this.startU + this.tileCount * progress;
    }

    renderer.setRenderTarget(readBuffer);
    this.fsQuad.render(renderer);

    renderer.autoClear = oldAutoClear;
    renderer.setClearColor(oldClearColor, oldClearAlpha);
  }

  /**
   * Render the mask texture which is two separate colours depending on if the object is hovered or selected.
   */
  private renderMaskTexture(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(this.maskRenderTarget);
    renderer.clear();

    this.scene.overrideMaterial = this.hoverMaskMaterial;
    this.camera.layers.set(1);
    renderer.render(this.scene, this.camera);

    this.scene.overrideMaterial = this.selectedMaskMaterial;
    this.camera.layers.set(2);
    renderer.render(this.scene, this.camera);

    this.camera.layers.set(0);
    this.scene.overrideMaterial = null;
  }

  private renderBlurTexture(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(this.blurHorizontalRenderTarget);
    renderer.clear();

    this.fsQuad.material = this.blurMaterial;
    this.blurMaterial.uniforms.colorTexture.value = this.maskRenderTarget.texture;
    this.blurMaterial.uniforms.direction.value = this.blurHorizontalDirection;
    this.fsQuad.render(renderer);

    // Rendering a second time in a vertical direction fixes some issues with the lines for pointy objects in a vertical direction.
    // For example otherwise the outline doesn't fully cover the object.
    renderer.setRenderTarget(this.blurVerticalRenderTarget);
    renderer.clear();
    this.blurMaterial.uniforms.colorTexture.value = this.blurHorizontalRenderTarget.texture;
    this.blurMaterial.uniforms.direction.value = this.blurVerticalDirection;
    this.fsQuad.render(renderer);
  }

  private renderBlurHalfTexture(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(this.blurHorizontalHalfRenderTarget);
    renderer.clear();

    this.fsQuad.material = this.blurHalfMaterial;
    this.blurHalfMaterial.uniforms.colorTexture.value = this.maskRenderTarget.texture;
    this.blurHalfMaterial.uniforms.direction.value = this.blurHorizontalDirection;
    this.fsQuad.render(renderer);

    renderer.setRenderTarget(this.blurVerticalHalfRenderTarget2);
    renderer.clear();
    this.blurHalfMaterial.uniforms.colorTexture.value = this.blurHorizontalHalfRenderTarget.texture;
    this.blurHalfMaterial.uniforms.direction.value = this.blurVerticalDirection;
    this.fsQuad.render(renderer);
  }

  private createOutlineMaterial(outputMode: AnimatedTextureBlurOutlineOutputMode): ShaderMaterial {
    return createOutlineMaterial({
      outputMode,
      hoverTexture: (this.hoverTexture as WebGLRenderTarget)?.texture || this.hoverTexture,
      selectedTexture: (this.selectedTexture as WebGLRenderTarget)?.texture || this.selectedTexture,
      startU: this.startU,
      tileCount: this.tileCount,
    });
  }
}
