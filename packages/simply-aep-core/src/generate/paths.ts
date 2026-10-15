/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type AepLayout = { mainClasses: string; mainSchema: string; testClasses: string };

export const DEFAULT_LAYOUT: AepLayout = {
  mainClasses: 'main/classes',
  mainSchema: 'main/schema',
  testClasses: 'test/classes',
};

export class PathResolver {
  public constructor(private readonly layout: AepLayout = DEFAULT_LAYOUT) {}

  public appFactoryBindings(): string {
    return `${this.layout.mainSchema}/custommetadata/applicationFactoryBindings`;
  }

  public selectorClassDir(): string {
    return `${this.layout.mainClasses}/selectors`;
  }

  public selectorTestDir(): string {
    return `${this.layout.testClasses}/selectors`;
  }

  public selectorBindingDir(): string {
    return `${this.appFactoryBindings()}/selectorBindings`;
  }

  public domainClassDir(): string {
    return `${this.layout.mainClasses}/domains`;
  }

  public domainTestDir(): string {
    return `${this.layout.testClasses}/domains`;
  }

  public domainBindingDir(): string {
    return `${this.appFactoryBindings()}/domainBindings`;
  }

  public criteriaClassDir(): string {
    return `${this.layout.mainClasses}/criteria`;
  }

  public criteriaTestDir(): string {
    return `${this.layout.testClasses}/criteria`;
  }

  public actionClassDir(): string {
    return `${this.layout.mainClasses}/actions`;
  }

  public actionTestDir(): string {
    return `${this.layout.testClasses}/actions`;
  }

  public domainProcessBindingDir(): string {
    return `${this.appFactoryBindings()}/domainProcessBindings`;
  }

  public triggerDir(): string {
    return `${this.layout.mainSchema}/triggers`;
  }

  public serviceClassDir(): string {
    return `${this.layout.mainClasses}/services`;
  }

  public serviceTestDir(): string {
    return `${this.layout.testClasses}/services`;
  }

  public serviceBindingDir(): string {
    return `${this.appFactoryBindings()}/serviceBindings`;
  }

  public uowBindingDir(): string {
    return `${this.appFactoryBindings()}/unitOfWorkBindings`;
  }

  public selectorInclusionBindingDir(): string {
    return `${this.appFactoryBindings()}/selectorConfigFieldSetInclusions`;
  }

  public fieldSetDir(sobjectApiName: string): string {
    return `${this.layout.mainSchema}/objects/${sobjectApiName}/fieldSets`;
  }
}
