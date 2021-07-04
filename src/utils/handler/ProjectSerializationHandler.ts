import { GroupComponent } from "../components/GroupComponent";
import { Image } from "../components/Image";
import { Template } from "../components/Template";
import { BACKEND_URL } from "../Config";
import {
  invisibleIDs,
  JsonObject,
  traverseComponent,
  unregisterComponent
} from "../manager/ComponentManager";
import {
  DEFAULT_FONTS,
  fonts,
  regFonts,
  registerFontBase64,
  unregisterFont
} from "../manager/FontManager";
import {
  DEFAULT_IMAGES,
  images,
  regImages,
  registerImageBase64,
  unregisterImage
} from "../manager/ImageManager";
import { licensePromptDoneAction } from "../manager/ProjectManager";
import { settings } from "../manager/SettingsManager";
import { migrate, VERSION } from "../manager/UpdateManager";
import {
  addJsonComponentsToRoot,
  componentTree,
  error,
  info,
  loading,
  pauseRendering,
  selection
} from "../manager/WorkspaceManager";
import { Project } from "../Project";

function createComponentTreeGroup() {
  return new GroupComponent(
    "component_tree",
    "-",
    [],
    componentTree.value,
    true
  );
}

export function bundleProjectData() {
  const usedImages: string[] = [];

  componentTree.value.forEach(comp =>
    traverseComponent(comp, c => {
      if (c.displayName == Image.displayName) {
        usedImages.push((c as Image).image);
      }
    })
  );

  const projectData: Project = {
    name: settings.projectName,
    version: VERSION,
    invisible: invisibleIDs.value,
    fonts: Object.values(fonts).filter(
      font => !DEFAULT_FONTS.includes(font.name)
    ),
    width: settings.width,
    height: settings.height,
    images: Object.values(images)
      .filter(image => !image.isGif)
      .filter(
        image =>
          !DEFAULT_IMAGES.includes(image.name) ||
          usedImages.includes(image.name)
      )
      .map(image => ({
        name: image.name,
        data: image.data.src
      })),
    gifs: Object.values(images)
      .filter(image => image.isGif)
      .map(image => ({
        name: image.name,
        data: image.data.src
      })),
    componentTree: JSON.parse(createComponentTreeGroup().toJson())
  };

  return projectData;
}

export async function downloadProjectFile(savepoint: Project, key: string) {
  function downloadJson(data: string) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(data);
    const dlAnchorElem = document.getElementById("downloadAnchor")!;
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute(
      "download",
      savepoint.name.replaceAll(" ", "_") + ".json"
    );
    dlAnchorElem.click();
  }

  loading(true);

  try {
    const resp = await fetch(
      // "http://127.0.0.1:3000/sync",
      `${BACKEND_URL}/convert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          key,
          savepoint: {
            invisible: invisibleIDs.value,
            componentTree: JSON.parse(createComponentTreeGroup().toJson(true))
          }
        })
      }
    );

    const data = await resp.text();

    if (resp.status >= 400) throw data;

    const { invisible, componentTree } = JSON.parse(data);

    downloadJson(
      JSON.stringify({
        ...savepoint,
        invisible,
        exportedTree: componentTree
      })
    );
    loading(false);
  } catch (exc) {
    const errorText = `Error durring export: ${exc.message || exc}`;
    const licenseError =
      errorText.toLocaleLowerCase().includes("licence") ||
      errorText.toLocaleLowerCase().includes("license");
    error(
      errorText,
      licenseError
        ? {
            label: "Change license key",
            callback: () => {
              licensePromptDoneAction.value = () => {
                /**/
              };
            }
          }
        : undefined
    );
  }
}

export async function downloadCurrentProjectFile(key: string) {
  loading(true);
  const savepoint: Project = bundleProjectData();
  await downloadProjectFile(savepoint, key);
  loading(false);
}

function checkForUpdate(project: Project) {
  if (project.version != VERSION) {
    const oldVersion = project.version;
    const updated = migrate(project);
    info(
      `Your savepoint was still on format-version <b>${oldVersion}</b> and got migrated to the new format-version <b>${VERSION}</b>`,
      true
    );
    return updated;
  }
  return project;
}

export function importComponentFomJson(componentProject: Project) {
  const type = (componentProject.componentTree.components[0] as JsonObject)
    ?.type;
  if (
    componentProject.componentTree.components.length != 1 ||
    !(type == GroupComponent.displayName || type == Template.displayName)
  ) {
    error(
      "You can only import layout files as a component if they contain exactly one group or template component."
    );
  }

  pauseRendering.value = true;
  componentProject = checkForUpdate(componentProject);
  invisibleIDs.value.push(...componentProject.invisible);
  addJsonComponentsToRoot(componentProject.componentTree.components, false);
  pauseRendering.value = false;
}

export async function loadProjectFromJson(
  jsonObj: Project,
  keepResrouces = false
) {
  jsonObj = checkForUpdate(jsonObj);

  pauseRendering.value = true;
  if (!keepResrouces) {
    regImages.forEach(img => {
      if (!DEFAULT_IMAGES.includes(img)) unregisterImage(img);
    });
    regFonts.forEach(font => {
      if (!DEFAULT_FONTS.includes(font)) unregisterFont(font);
    });
  }

  selection.value = null;

  componentTree.value.forEach(elem => unregisterComponent(elem));
  componentTree.value = [];

  settings.projectName = jsonObj.name || "Starter";

  settings.width = jsonObj.width;
  settings.height = jsonObj.height;

  invisibleIDs.value = jsonObj.invisible;

  addJsonComponentsToRoot(jsonObj.componentTree.components, false);

  if (!keepResrouces) {
    try {
      await Promise.all([
        ...jsonObj.fonts!.map(font => {
          if (!DEFAULT_FONTS.includes(font.name))
            registerFontBase64(font.data, font.name);
        }),
        ...jsonObj.images!.map(image => {
          if (!DEFAULT_IMAGES.includes(image.name))
            registerImageBase64(image.data, image.name, false);
        }),
        ...jsonObj.gifs!.map(image =>
          registerImageBase64(image.data, image.name, true)
        )
      ]);
    } catch (exc) {
      console.error(exc);
    }
  }

  pauseRendering.value = false;
}
