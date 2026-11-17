; 制作结算台 · Inno Setup 安装包脚本（4.11）
; 只在需要对外分发时使用：build_exe.py 打出 onedir 目录后，用它封一个可卸载的安装包。
; 编译：ISCC.exe tools\inno\settlement-tool.iss /DAppVersion=2.9.0 /DSourceDir=<发行目录>
;
; 设计取舍：
;   - 不做「联机检查更新」：本工具离线优先，更新就是把新目录整包替换。
;   - 不注册文件关联：结算台不是文件编辑器，没有必要抢占 .json / .xlsx 的默认程序。
;   - 快捷方式只在开始菜单与桌面建，卸载时一并清掉。

#define AppName "制作结算台"
#ifndef AppVersion
  #define AppVersion "2.9.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\SettlementTool"
#endif
#define AppExe "SettlementTool.exe"

[Setup]
AppId={{6C7B7F36-9A4A-4D6E-9E1B-4C0C2D3A15E2}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=7Feng
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=settlement-tool-{#AppVersion}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; 数据落在 %LOCALAPPDATA%\SettlementTool，不放在安装目录，卸载不会带走账本
UninstallDisplayIcon={app}\{#AppExe}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversi

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent
