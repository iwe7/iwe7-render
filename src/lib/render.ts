import {
  Injector,
  Injectable,
  NgModuleRef,
  ComponentFactoryResolver,
  NgModuleFactoryLoader,
  NgModuleFactory,
  Inject,
  ViewContainerRef,
  ɵisObservable,
  Compiler,
  ɵisPromise,
  Type
} from "@angular/core";
import { fromPromise } from "rxjs/observable/fromPromise";
import { from, Observable, Subscriber, fromEvent } from "rxjs";
import { map, tap, switchMap, filter } from "rxjs/operators";

import { ROUTES } from "@angular/router";
import { flatten, map as _map } from "underscore";

export interface KeyValue {
  [index: string]: string;
}
export interface RenderChildren {
  [index: string]: any;
  [index: number]: any;
}
export interface RenderOptions {
  selector: string;
  inputs: KeyValue;
  outputs: string[];
  children: RenderChildren;
}

let dragData: any;

@Injectable()
export class MeepoRender {
  private componentFactoryResolver: ComponentFactoryResolver;
  private components: Map<string, any> = new Map();
  constructor(
    private moduleFactoryLoader: NgModuleFactoryLoader,
    private moduleRef: NgModuleRef<any>,
    @Inject(ROUTES) private lazy: any,
    private injector: Injector,
    private ngCompiler: Compiler
  ) {
    this.lazy = flatten(this.lazy);
    this.lazy.map((res: any) => {
      let { children } = res;
      if (children) {
        children.map(child => {
          this.components.set(child.path, {
            path: child.loadChildren,
            data: child.data
          });
        });
      } else {
        this.components.set(res.path || res.selector, {
          path: res.loadChildren,
          data: res.data
        });
      }
    });
  }

  private compileModuleAndAllComponentsAsync(moduleType: Type<any>) {
    return new Promise((resolve, reject) => {
      this.ngCompiler
        .compileModuleAndAllComponentsAsync(moduleType)
        .then(res => {
          resolve(res.ngModuleFactory);
        });
    });
  }

  private createElement(json: RenderOptions) {
    let comp = this.components.get(json.selector);
    if (comp) {
      if (typeof comp.path === "function") {
        let type = comp.path();
        // 检查是否promise
        if (ɵisPromise(type)) {
          return type.then(res => {
            return this.compileModuleAndAllComponentsAsync(type);
          });
        } else if (ɵisObservable(type)) {
          return new Promise((resolve, reject) => {
            type.subscribe(res => {
              this.compileModuleAndAllComponentsAsync(type).then(res => {
                resolve(res);
              });
            });
          });
        } else {
          return this.compileModuleAndAllComponentsAsync(type);
        }
      } else {
        return this.moduleFactoryLoader.load(comp.path);
      }
    } else {
      return new Promise((resolve, reject) => {
        reject(`${json.selector} not found`);
      });
    }
  }
  // 编译成html
  compiler(json: RenderOptions, view: ViewContainerRef) {
    return fromPromise(this.createElement(json)).pipe(
      // NgModuleFactory
      map((ngModuleFactory: NgModuleFactory<any>) => {
        let moduleRef = ngModuleFactory.create(this.injector);
        return {
          resolver: moduleRef.componentFactoryResolver,
          instance: moduleRef.instance
        };
      }),
      // component
      map(res => {
        if ("get" in res.instance) {
          let component = res.instance.get(json.selector);
          if (typeof component === "function") {
            return res.resolver.resolveComponentFactory(component);
          } else {
            console.warn(`${json.selector}的ngModule->get方法没有返回正确的值`);
            return false;
          }
        }
        // 兼容老板本
        else if ("getComponentByName" in res.instance) {
          let component = res.instance.getComponentByName(json.selector);
          if (typeof component === "function") {
            return res.resolver.resolveComponentFactory(component);
          } else {
            console.warn(
              `${
                json.selector
              }的ngModule->getComponentByName方法没有返回正确的值`
            );
            return false;
          }
        } else {
          console.warn(
            `${json.selector}的ngModule没有get或者getComponentByName方法`
          );
          return false;
        }
      }),
      filter(res => !!res),
      // 挂载到试图
      map((component: any) => {
        return view.createComponent(component);
      }),
      // 返回实例
      map(res => {
        return res.instance;
      }),
      // 绑定inputs
      tap(instance => {
        _map(json.inputs || {}, (item, key) => {
          Object.defineProperty(instance, key, {
            get: () => {
              return item;
            },
            set: val => {
              item = val;
            }
          });
        });
      }),
      tap((instance: any) => {
        if (instance.draggable) {
          console.log("我可以拖动");
          fromEvent(instance.ele.nativeElement, "dragstart")
            .pipe(
              tap((evt: DragEvent) => {
                dragData = json;
              })
            )
            .subscribe();
        }
        if (instance.dropable) {
          fromEvent(instance.ele.nativeElement, "dragover")
            .pipe(
              // debug
              tap((res: DragEvent) => {
                res.preventDefault();
              })
            )
            .subscribe();
          fromEvent(instance.ele.nativeElement, "drop")
            .pipe(
              tap((evt: DragEvent) => {
                // 拿到拖放数据，赋值
                if (json.children) {
                  json.children.view.push(dragData);
                } else {
                  json["children"] = {
                    view: [dragData]
                  };
                }
                this.compiler(dragData, instance["view"]).subscribe(
                  (res: any) => {
                    console.log("to do ");
                  }
                );
                // json.children.dropView = dragData;
              })
            )
            .subscribe();
        }
      }),
      // 绑定outputs
      switchMap(instance => {
        return Observable.create((subscriber: Subscriber<any>) => {
          // render children
          _map(json.children, (item, key) => {
            if (instance[key]) {
              if (Array.isArray(item)) {
                _map(item, (child, index) => {
                  this.compiler(child, instance[key]).subscribe((res: any) => {
                    subscriber.next({
                      type: res.type,
                      data: res.data
                    });
                  });
                });
              } else {
                this.compiler(item, instance[key]).subscribe((res: any) => {
                  subscriber.next({
                    type: res.type,
                    data: res.data
                  });
                });
              }
            }
          });
          (json.outputs || []).map(output => {
            if (ɵisObservable(instance[output])) {
              instance[output].subscribe(res => {
                subscriber.next({
                  type: output,
                  data: res
                });
              });
            }
          });
        });
      })
    );
  }
}
