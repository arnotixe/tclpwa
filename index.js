const { Finder, Remote } = require("./tcl-remote.cjs.development");

// wonder where these came from
const keydefs = [
  "TR_KEY_RED",
  "TR_KEY_GREEN",
  "TR_KEY_YELLOW",
  "TR_KEY_BLUE",
  "TR_KEY_INPUT",
  "TR_KEY_TUNER",
  "TR_KEY_VOL_UP",
  "TR_KEY_CH_UP",
  "TR_KEY_MUTE",
  "TR_KEY_VOL_DOWN",
  "TR_KEY_CH_DOWN",
  "TR_KEY_LIST",
  "TR_KEY_SMARTTV",
  "TR_KEY_GUIDE",
  "TR_KEY_MAINMENU",
  "TR_KEY_UP",
  "TR_KEY_INFOWINDOW",
  "TR_KEY_LEFT",
  "TR_KEY_OK",
  "TR_KEY_RIGHT",
  "TR_KEY_BACK",
  "TR_KEY_DOWN",
  "TR_KEY_EXIT",
  "TR_KEY_1",
  "TR_KEY_2",
  "TR_KEY_3",
  "TR_KEY_4",
  "TR_KEY_5",
  "TR_KEY_6",
  "TR_KEY_7",
  "TR_KEY_8",
  "TR_KEY_9",
  "TR_KEY_0",
  "TR_KEY_FAVORITE",
  "TR_KEY_YOUTUBE",
  "TR_KEY_APP",
  "TR_KEY_AT",
  "TR_KEY_PICTURE",
  "TR_KEY_SOUND",
  "TR_KEY_MTS",
  "TR_KEY_CC",
  "TR_KEY_USB",
  "TR_KEY_OPTION",
  "TR_KEY_SLEEP",
  "TR_KEY_3D",
  "TR_KEY_REW",
  "TR_KEY_PLAYPAUSE",
  "TR_KEY_FF",
  "TR_KEY_PREVIOUS",
  "TR_KEY_SUSPEND",
  "TR_KEY_NEXT",
  "TR_KEY_AIRCABLE",
  "TR_KEY_HOME",
  "TR_KEY_SEARCH",
  "TR_KEY_I",
  "TR_KEY_REC",
  "TR_KEY_TV",
  "TR_KEY_AMAZON",
  "TR_KEY_VUDU",
  "TR_KEY_MGO",
  "TR_KEY_ZOOM_DOWN",
  "TR_KEY_ZOOM_UP",
  "TR_KEY_SLEEP_DOWN",
  "TR_KEY_SLEEP_UP",
  "TR_KEY_MEDIA",
  "TR_KEY_SOURCE",
  "TR_KEY_TEXT",
  "TR_KEY_PLAY",
  "TR_KEY_PAUSE",
  "TR_KEY_FORMAT",
  "TR_KEY_SCALE",
  "TR_KEY_PRE_CH",
  "TR_KEY_FREEZE",
  "TR_KEY_EPG",
  "TR_KEY_SUBTITLE",
  "TR_KEY_DISPLAY",
  "TR_KEY_LANG",
  "TR_KEY_APPSTORE",
  "TR_KEY_ALLAPP",
  "TR_KEY_ECO",
  "TR_KEY_POWER",
];

const getKey = () => {
  return new Promise((resolve, reject) => {
    const readline = require("readline");
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (char, key) => {
      if (key && key.ctrl && key.name === "c") {
        // Handle Ctrl+C to exit cleanly
        process.exit();
      }

      switch (key?.name) {
        case "0": {
          resolve("TR_KEY_0");
          break;
        }
        case "1": {
          resolve("TR_KEY_1");
          break;
        }
        case "2": {
          resolve("TR_KEY_2");
          break;
        }
        case "3": {
          resolve("TR_KEY_3");
          break;
        }
        case "4": {
          resolve("TR_KEY_4");
          break;
        }
        case "5": {
          resolve("TR_KEY_5");
          break;
        }
        case "6": {
          resolve("TR_KEY_6");
          break;
        }
        case "7": {
          resolve("TR_KEY_7");
          break;
        }
        case "8": {
          resolve("TR_KEY_8");
          break;
        }
        case "9": {
          resolve("TR_KEY_9");
          break;
        }
        // case "t": {
        //   resolve("TR_KEY_TV");
        //   break;
        // }
        case "x": {
          // resolve("TR_KEY_INFOWINDOW"); // shows a little top right info on connection
          // resolve("TR_KEY_MUTE"); // mute works
          // resolve("TR_KEY_TV"); // switches to TV (antenna)
          //
          // maybe context dependent
          // resolve("TR_KEY_LIST"); // no reaction, but shows channel list in TV mode
          // resolve("TR_KEY_INPUT");// no reaction
          // resolve("TR_KEY_EXIT"); // no reaction
          // resolve("TR_KEY_HOME"); // no reaction
          // resolve("TR_KEY_TUNER"); // no reaction
          // resolve("TR_KEY_NEXT"); // no reaction
          // Keys["Search"] = "TR_KEY_SEARCH"; // no reaction
          // resolve("TR_KEY_SOURCE"); // no reaction
          // Keys["I"] = "TR_KEY_I"; // no reaction
          // resolve("TR_KEY_MEDIA"); // no reaction
          // resolve("TR_KEY_ALLAPP"); // no reaction
          // resolve("TR_KEY_PRE_CH"); // no reaction
          // resolve("TR_KEY_EPG"); // no reaction
          // resolve("TR_KEY_APPSTORE"); // no reaction
          // resolve("TR_KEY_DISPLAY"); // no reaction
          // resolve("TR_KEY_RED"); // no reaction
          //resolve("TR_KEY_YELLOW"); // no reaction
          // resolve("TR_KEY_GREEN"); // no reaction
          // resolve("TR_KEY_BLUE");
          // resolve("TR_KEY_PREVIOUS");
          // resolve("TR_KEY_FAVORITE"); //
          // resolve("TR_KEY_USB"); // no reaction
          // resolve("TR_KEY_YOUTUBE"); // no reaction

          resolve("*");
          break;
        }
        case "n": {
          resolve("TR_KEY_PLAYPAUSE"); // opens netflix
          break;
        }
        case "s": {
          resolve("TR_KEY_SMARTTV"); // smart tv menu, gets stuck until manual selection it seems, no back
          break;
        }
        case "g": {
          resolve("TR_KEY_GUIDE"); // "not available" on chrome at least
          // probably channel guide of sorts
          break;
        }
        case "escape":
        case "backspace": {
          resolve("TR_KEY_BACK");
          break;
        }
        case "m": {
          resolve("TR_KEY_MUTE");
          break;
        }
        case "o": {
          // resolve("TR_KEY_OPTION"); // both same
          // resolve("TR_KEY_MAINMENU"); // config menu really
          break;
        }
        case "return": {
          resolve("TR_KEY_OK"); // select. Sometimes Right is used instead, for submenus
          break;
        }
        case "up": {
          resolve("TR_KEY_UP");
          break;
        }
        case "down": {
          resolve("TR_KEY_DOWN");
          break;
        }
        case "left": {
          resolve("TR_KEY_LEFT");
          break;
        }
        case "right": {
          resolve("TR_KEY_RIGHT");
          break;
        }
        default: {
          switch (key?.sequence) {
            case "+": {
              resolve("TR_KEY_VOL_UP");
              break;
            }
            case "-": {
              resolve("TR_KEY_VOL_DOWN");
              break;
            }
            default: {
              console.log("unknown key pressed", key);
              resolve(null);
              break;
            }
          }
        }
      }
    });

    // stdin.on("data", function (key) {
    //   const code = key.codePointAt(0);
    //   console.log("key", typeof key, key, code, key.length);

    //   if (key === "\u0003") {
    //     // ctl-c or escape
    //     console.log("ctrl-c or esc");
    //     process.exit();
    //   }
    //   // write the key to stdout all normal like
    //   console.log("key", code);
    //   stdin.pause();
    //   switch (code) {
    //     case 109: // m
    //       resolve("TR_KEY_MAINMENU");
    //       break;
    //     case 13: // enter
    //       resolve("TR_KEY_OK");
    //       break;
    //     default:
    //       console.log("unknown key", code);
    //       resolve(null);
    //       break;
    //   }
    //   // process.stdout.write(key);
    // });
  });
};

async function main() {
  // let tv = "http://192.168.100.55:49152/tvrenderdesc.xml";
  let tv = "";
  // let tv = "192.168.100.55";
  let finder = null;
  if (!tv) {
    // Create a Finder object
    finder = new Finder();
    // console.log("finder", finder);

    // Find the first possible location of a TCL tv
    tv = await finder.find();
    console.log("found TV at", tv);
  }
  if (finder) {
    await finder.close();
  }

  console.log("Enter commands +-m s g x q to control TV, Ctrl-C to exit", tv);

  const remote = new Remote(tv);
  // await remote.init();
  // await remote.ping();

  while (true) {
    const key = await getKey();
    if (key === "q") {
      break;
    }
    if (key) {
      if (key === "*") {
        const keyMappings = [
          // "TR_KEY_TUNER",
          // "TR_KEY_FAVORITE",
          // "TR_KEY_YOUTUBE",
          // "TR_KEY_APP",
          // "TR_KEY_AT",
          // "TR_KEY_APP",
          // "TR_KEY_PICTURE",
          // "TR_KEY_SOUND",
          // "TR_KEY_MTS",
          // "TR_KEY_CC",
          // "TR_KEY_3D",
          // "TR_KEY_REW",
          // "TR_KEY_PLAYPAUSE",
          // "TR_KEY_FF",
          // "TR_KEY_SUSPEND",
          // "TR_KEY_AIRCABLE",
          // "TR_KEY_REC",
          // "TR_KEY_AMAZON",
          // "TR_KEY_VUDU",
          // "TR_KEY_MGO",
          // "TR_KEY_ZOOM_DOWN",
          // "TR_KEY_ZOOM_UP",
          // "TR_KEY_SLEEP_DOWN",
          // "TR_KEY_SLEEP_UP",
          // "TR_KEY_TEXT",
          // "TR_KEY_PLAY",
          // "TR_KEY_FORMAT",
          // "TR_KEY_SCALE",
          // "TR_KEY_FREEZE",
          // "TR_KEY_SUBTITLE",
          // "TR_KEY_LANG",
          // "TR_KEY_SLEEP",
          //
          // "TR_KEY_PAUSE", // seems to start PVR (pause current media and buffer?)
          // "TR_KEY_ECO", // opens eco menu
          // "TR_KEY_POWER", // power off
        ];

        for (const key of keyMappings) {
          await remote.press(key);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } else {
        await remote.press(key);
      }
    }
  }

  process.exit(0);
}

main();
