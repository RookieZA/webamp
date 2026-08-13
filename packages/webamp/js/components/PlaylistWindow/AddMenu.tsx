import * as Selectors from "../../selectors";
import * as Actions from "../../actionCreators";
import PlaylistMenu from "./PlaylistMenu";

import { useTypedSelector, useActionCreator } from "../../hooks";

const AddMenu = () => {
  const nextIndex = useTypedSelector(Selectors.getTrackCount);
  const addDirAtIndex = useActionCreator(Actions.addDirAtIndex);
  const addFilesAtIndex = useActionCreator(Actions.addFilesAtIndex);
  const addFilesFromUrl = useActionCreator(Actions.addFilesFromUrl);
  const addYouTubePlaylist = useActionCreator(Actions.addYouTubePlaylist);
  return (
    <PlaylistMenu id="playlist-add-menu">
      <div className="add-url" onClick={() => addFilesFromUrl(nextIndex)} />
      <div className="add-dir" onClick={() => addDirAtIndex(nextIndex)} />
      <div className="add-file" onClick={() => addFilesAtIndex(nextIndex)} />
      {/* Not a Winamp original, so skins have no sprite for it. Labelled
          with text rather than left invisible. */}
      <div className="add-ytlist" onClick={addYouTubePlaylist}>
        YTLIST
      </div>
    </PlaylistMenu>
  );
};

export default AddMenu;
