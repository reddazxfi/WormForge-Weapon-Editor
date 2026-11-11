// The exported ZIPs ship the wfws.sdk library, so the editor needs its files as
// strings. They are imported straight from `spec/` with Vite's `?raw`: one
// source of truth, so editing the SDK under `spec/lua_sdk/wfws_sdk/` reaches
// every export with no copy to keep in sync (the old hand copy drifted).
import wfwsSdkToml from '../../spec/lua_sdk/wfws_sdk/mod.toml?raw';
import wfwsSpriteBuilderLua from '../../spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua?raw';

/** mod.toml for the wfws.sdk library bundle. */
export const WFWS_SDK_MOD_TOML = wfwsSdkToml;

/** `wf-lib/wfws_sprite_builder`, the module the generated weapon requires. */
export const WFWS_SPRITE_BUILDER_LUA = wfwsSpriteBuilderLua;
