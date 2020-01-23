import { LinearEncoding, NearestFilter, WebGLRenderTarget } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader";
import { ProductConfigurator } from "./ProductConfigurator";
import { getOnProgressCallback } from "./getOnProgressCallback";
import { PMREMGenerator } from "three/src/extras/PMREMGenerator";

export class EnvironmentMapLoader {
  public environments: { [key: string]: Promise<WebGLRenderTarget> } = {};

  private productConfigurator: ProductConfigurator;

  constructor(productChanger: ProductConfigurator) {
    this.productConfigurator = productChanger;
  }

  public loadEnvironment(file: string): Promise<WebGLRenderTarget> {

    if (this.environments[file]) {
      return this.environments[file];
    }

    const promise: Promise<WebGLRenderTarget> = new Promise(async (resolve, reject) => {
      const renderer = this.productConfigurator.renderer;

      new EXRLoader().load( file, ( texture ) => {
        texture.minFilter = NearestFilter;
        texture.encoding = LinearEncoding;

        const pmremGenerator = new PMREMGenerator(renderer);
        const renderTarget = pmremGenerator.fromEquirectangular(texture);

        texture.dispose();
        pmremGenerator.dispose();

        // this.productConfigurator.scene.background = renderTarget.texture;
        resolve(renderTarget);
      }, getOnProgressCallback(this.productConfigurator.productConfiguratorService));
    });

    this.environments[file] = promise;

    return promise;
  }
}
