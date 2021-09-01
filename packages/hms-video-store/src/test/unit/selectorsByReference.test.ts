import { localAudio, localVideo, makeFakeStore } from '../fakeStore';
import {
  HMSStore,
  selectIsLocalVideoPluginPresent,
  selectIsLocalAudioPluginPresent,
} from '../../core';

let fakeStore: HMSStore;

// start from a new fake store for every test
beforeEach(() => {
  fakeStore = makeFakeStore();
});
describe('test selectors by reference', () => {
  test('select is plugin present', () => {
    localVideo.plugins = ['plugin1', 'plugin2'];
    localAudio.plugins = ['plugin1', 'plugin2'];

    expect(selectIsLocalVideoPluginPresent('plugin1')(fakeStore)).toBe(true);
    expect(selectIsLocalVideoPluginPresent('plugin2')(fakeStore)).toBe(true);
    expect(selectIsLocalVideoPluginPresent('plugin3')(fakeStore)).toBe(false);

    expect(selectIsLocalAudioPluginPresent('plugin1')(fakeStore)).toBe(true);
    expect(selectIsLocalAudioPluginPresent('plugin2')(fakeStore)).toBe(true);
    expect(selectIsLocalAudioPluginPresent('plugin3')(fakeStore)).toBe(false);
  });
});