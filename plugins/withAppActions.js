const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const shortcutsXml = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
    <capability android:name="actions.intent.CREATE_EVENT">
        <intent
            android:action="android.intent.action.VIEW"
            android:targetPackage="com.jothacsf.Organiza"
            android:targetClass="com.jothacsf.Organiza.MainActivity">
            <url-template android:value="lumen://gemini/adicionar_evento{?titulo,data}" />
            <parameter android:name="event.name" android:key="titulo"/>
            <parameter android:name="event.startDate" android:key="data"/>
        </intent>
    </capability>

    <capability android:name="custom.actions.intent.RECORD_ATTENDANCE">
        <intent
            android:action="android.intent.action.VIEW"
            android:targetPackage="com.jothacsf.Organiza"
            android:targetClass="com.jothacsf.Organiza.MainActivity">
            <url-template android:value="lumen://gemini/marcar_falta{?materia,tipo}" />
            <parameter android:name="attendance.subject" android:key="materia"/>
            <parameter android:name="attendance.status" android:key="tipo"/>
        </intent>
    </capability>
</shortcuts>
`;

function withAppActions(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const resPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      if (!fs.existsSync(resPath)) {
        fs.mkdirSync(resPath, { recursive: true });
      }
      fs.writeFileSync(path.join(resPath, 'shortcuts.xml'), shortcutsXml);
      return config;
    },
  ]);

  config = withAndroidManifest(config, async (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);

    if (!mainActivity['meta-data']) {
      mainActivity['meta-data'] = [];
    }
    
    const hasShortcuts = mainActivity['meta-data'].some(m => m.$ && m.$['android:name'] === 'android.app.shortcuts');
    if (!hasShortcuts) {
      mainActivity['meta-data'].push({
        $: {
          'android:name': 'android.app.shortcuts',
          'android:resource': '@xml/shortcuts',
        },
      });
    }

    if (!mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = [];
    }

    const oauthSchemes = [
      'lumen',
      'com.jothacsf.organiza',
      'com.jothacsf.Organiza',
      'com.googleusercontent.apps.505145390874-dsluagocjfj15rjso9nsbgc282d4nvv8',
    ];

    oauthSchemes.forEach((scheme) => {
      const exists = mainActivity['intent-filter'].some(
        filter =>
          filter.action?.some(a => a.$ && a.$['android:name'] === 'android.intent.action.VIEW') &&
          filter.data?.some(d => d.$ && d.$['android:scheme'] === scheme)
      );

      if (!exists) {
        mainActivity['intent-filter'].push({
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [{ $: { 'android:scheme': scheme } }],
        });
      }
    });

    return config;
  });

  return config;
}

module.exports = withAppActions;
