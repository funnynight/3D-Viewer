import type { ProductConfiguratorService } from "../../product-configurator.service";
import type { Subscription } from "rxjs";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { Camera, Scene, Vector2, WebGLRenderer } from "three";
import { AnimatedTextureBlurOutlinePass } from "./postprocessing/animated-texture-blur-outline/AnimatedTextureBlurOutlinePass";
import type { ProductItem } from "../models/product-item/ProductItem";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader";
import { SelectedProductHighlighter } from "../SelectedProductHighlighter";
import { generateRainbowTexture } from "./postprocessing/animated-texture-blur-outline/outline-texture-generators/generate-rainbow-texture";
import { generateSingleColorTexture } from "./postprocessing/animated-texture-blur-outline/outline-texture-generators/generate-single-color-texture";

export class EffectComposerHandler {
  private composer!: EffectComposer;
  private outlinePass: AnimatedTextureBlurOutlinePass;
  private gammaCorrectionPass: ShaderPass;

  private subscription: Subscription;

  constructor(
    productConfiguratorService: ProductConfiguratorService,
    selectedProductHighlighter: SelectedProductHighlighter,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ) {
    this.subscription = productConfiguratorService.selectedProductChanged.subscribe(product => this.onSelectedProductChanged(product));

    this.composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    this.gammaCorrectionPass = new ShaderPass(GammaCorrectionShader);

    this.outlinePass = new AnimatedTextureBlurOutlinePass(productConfiguratorService, selectedProductHighlighter, renderer.getSize(new Vector2(0, 0)), scene, camera);

    this.outlinePass.setColors({ hover: generateRainbowTexture(0) });
    this.outlinePass.setColors({ selected: generateSingleColorTexture("snow") });

    this.composer.addPass(renderPass);
    this.composer.addPass(this.gammaCorrectionPass);
    this.composer.addPass(this.outlinePass);
  }

  dispose(): void {
    this.subscription.unsubscribe();
  }

  private onSelectedProductChanged(product: ProductItem): void {
    this.gammaCorrectionPass.enabled = product.useGammaSpace;
  }

  render(): void {
    this.composer.render();
  }
}
