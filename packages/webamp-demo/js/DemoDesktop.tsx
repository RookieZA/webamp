import WebampLazy from "../../webamp/js/webampLazy";
import { Suspense, useState } from "react";
import WebampIcon from "./WebampIcon";
// import Mp3Icon from "./Mp3Icon";
import SkinIcon from "./SkinIcon";
import { /* defaultInitialTracks, */ SHOW_DESKTOP_ICONS } from "./config";
import { useWindowSize } from "../../webamp/js/hooks";
import availableSkins from "./availableSkins";
import DesktopIcon from "./DesktopIcon";
import DesktopLinkIcon from "./DesktopLinkIcon";
import SkinBrowser from "./SkinBrowser";
import { log } from "./logger";
import museumIcon from "../images/icons/internet-folder-32x32.png";
import soundcloudIcon from "../images/icons/soundcloud-32x32.png";
import { SoundCloudPlaylist } from "./SoundCloud";
// import MilkIcon from "./MilkIcon";

interface Props {
  webamp: WebampLazy;
  soundCloudPlaylist: SoundCloudPlaylist | null;
}

const ICON_WIDTH = 75;
const ICON_HEIGHT = 100;
const VERTICAL_MARGIN = 30;
const HORIZONTAL_MARGIN = 10;

const DemoDesktop = ({ webamp, soundCloudPlaylist }: Props) => {
  const { width } = useWindowSize();
  const [skinBrowserOpen, setSkinBrowserOpen] = useState(false);
  const visibleWidth = width - VERTICAL_MARGIN * 2;

  const columns = Math.floor(visibleWidth / ICON_WIDTH);

  const icons = [<WebampIcon webamp={webamp} />];

  if (SHOW_DESKTOP_ICONS) {
    icons.push(
      <DesktopIcon
        iconUrl={museumIcon}
        name="All Skins"
        onOpen={() => {
          log({ category: "SkinBrowser", action: "open", label: "desktop" });
          setSkinBrowserOpen(true);
        }}
      />,
      /*
      ...defaultInitialTracks.map((track) => {
        return <Mp3Icon webamp={webamp} track={track} />;
      }),
      */
      ...availableSkins.map((skin) => {
        return <SkinIcon webamp={webamp} skin={skin} />;
      }),
      /*
      <MilkIcon
        webamp={webamp}
        preset={{
          url:
            "https://s3-us-east-2.amazonaws.com/butterchurn-presets/65b9eea6e1cc6bb9f0cd2a47751a186f.json",
          name: "105",
        }}
      />
      */
    );
    if (soundCloudPlaylist != null) {
      icons.push(
        <DesktopLinkIcon
          iconUrl={soundcloudIcon}
          name={soundCloudPlaylist.title}
          href={soundCloudPlaylist.permalink_url}
        />
      );
    }
  }
  return (
    <>
      {skinBrowserOpen && (
        <SkinBrowser
          webamp={webamp}
          onClose={() => setSkinBrowserOpen(false)}
        />
      )}
      <div
        id="desktop"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          // bottom: 0,
          marginTop: VERTICAL_MARGIN,
          marginLeft: HORIZONTAL_MARGIN,
        }}
      >
        <Suspense
          fallback={null /* Wait for all icons to load before showing any */}
        >
          {icons.map((icon, i) => {
            const row = Math.floor(i / columns);
            const column = i % columns;
            return (
              <div
                className="loaded-icon"
                key={i}
                style={{
                  left: column * ICON_WIDTH,
                  top: row * ICON_HEIGHT,
                  width: ICON_WIDTH,
                  position: "absolute",
                }}
              >
                {icon}
              </div>
            );
          })}
        </Suspense>
      </div>
    </>
  );
};

export default DemoDesktop;
