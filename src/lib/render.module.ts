import { NgModule, ModuleWithProviders } from "@angular/core";
import { MeepoRender } from "./render";
@NgModule({
  providers: []
})
export class MeepoRenderModule {
  static forRoot(): ModuleWithProviders {
    return {
      ngModule: MeepoRender,
      providers: [MeepoRender]
    };
  }
}
