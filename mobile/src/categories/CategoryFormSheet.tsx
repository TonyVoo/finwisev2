import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LIMITS } from '@expense-tracker/shared';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY, VALIDATION_COPY, categoryNameTaken } from '../copy/strings';
import { space } from '../theme/tokens';
import { ColourPicker, ReservedColour, firstUnusedColour } from './ColourPicker';

/**
 * Create and edit a category: `docs/design/07-categories.md` §2 and §3.
 *
 * One sheet for both, because §3 describes edit as "the same `Sheet` as §2 with four
 * differences" - the title, the prefill, the primary button's label and enablement, and a
 * Delete button. Building two would invite them to drift on the five things they share.
 *
 * ### The `isDefault` category
 *
 * It can be **renamed** - the contract permits it and nothing depends on its literal name,
 * because it is identified by its flag (§3 rule 2). Its **colour is read-only**, so the
 * picker is replaced by a single swatch and a caption rather than disabled, and it shows
 * **no Delete button** (§3 rule 3), matching the row that has no swipe action.
 *
 * ### Validation
 *
 * Runs on blur, and then on every keystroke once an error has been shown - the same rule
 * the auth screens follow (`03-auth.md` §Behaviour rule 2). Showing an error while someone
 * is still typing the name is noise; refusing to clear one while they fix it is worse.
 *
 * The 64-character cap is enforced by `maxLength` rather than by an error, because "no
 * error is needed for a limit that cannot be exceeded" (§2 rule 3).
 */

export const CATEGORY_NAME_TEST_ID = 'category-name';
export const CATEGORY_SUBMIT_TEST_ID = 'category-submit';
export const CATEGORY_DELETE_TEST_ID = 'category-delete';

export interface CategoryDraft {
  readonly name: string;
  readonly color: string;
}

/** The category being edited, or `null` to create a new one. */
export interface EditedCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDefault: boolean;
}

export interface CategoryFormSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly editing: EditedCategory | null;
  readonly coloursInUse: readonly string[];
  /** Resolves true when the trimmed name is already worn by another live category. */
  readonly isNameTaken: (name: string) => Promise<boolean>;
  readonly onSubmit: (draft: CategoryDraft) => Promise<void>;
  /** Absent in create mode and on the `isDefault` row, which has no Delete. */
  readonly onDelete?: () => void;
}

export function CategoryFormSheet({
  visible,
  onClose,
  editing,
  coloursInUse,
  isNameTaken,
  onSubmit,
  onDelete,
}: CategoryFormSheetProps) {
  const [name, setName] = useState('');
  const [colour, setColour] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  // Validation is quiet until the field has been blurred once (§2 rule 3).
  const [validateEagerly, setValidateEagerly] = useState(false);

  /**
   * Seed the fields **once per presentation**.
   *
   * Two things make the ref necessary rather than fussy. The sheet stays mounted between
   * openings, so without re-seeding, a stale name from the last category edited would
   * prefill the next one. But re-seeding on every render of an *open* sheet would be
   * worse: `coloursInUse` changes when a category arrives by sync, and that would reset
   * the colour the user had just chosen out from under them. So the effect lists every
   * value it reads, and the ref decides when the body is allowed to run.
   */
  const seeded = useRef(false);

  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;

    setName(editing?.name ?? '');
    setColour(editing?.color ?? firstUnusedColour(coloursInUse));
    setError(undefined);
    setValidateEagerly(false);
  }, [visible, editing, coloursInUse]);

  const trimmed = name.trim();
  const isEdit = editing !== null;
  const colourIsReserved = editing?.isDefault === true;

  /** Whether anything differs from the stored row - edit mode's Save enablement (§3). */
  const changed =
    editing === null ||
    trimmed !== editing.name ||
    colour.toLowerCase() !== editing.color.toLowerCase();

  const validate = useCallback(
    async (candidate: string): Promise<string | undefined> => {
      if (candidate.trim().length === 0) return VALIDATION_COPY.category.empty;
      // Uniqueness excludes the row being edited, so saving a category without changing
      // its name is not a conflict with itself (§3 rule 1).
      if (await isNameTaken(candidate.trim())) return categoryNameTaken(candidate.trim());
      return undefined;
    },
    [isNameTaken],
  );

  const onChangeName = (next: string) => {
    setName(next);
    if (!validateEagerly) return;
    // Already in error, so re-check on every keystroke - the user is fixing it.
    void validate(next).then(setError);
  };

  const onBlurName = () => {
    setValidateEagerly(true);
    void validate(name).then(setError);
  };

  const submit = () => {
    void validate(name).then(async (found) => {
      setValidateEagerly(true);
      setError(found);
      if (found !== undefined) return;
      await onSubmit({ name: trimmed, color: colour });
    });
  };

  /**
   * Why the primary button is unavailable, or undefined when it is.
   *
   * `Button` takes the reason rather than a boolean and renders it as helper text, so
   * there is no way to disable this without saying why (`components/Button.tsx`).
   */
  const disabledReason =
    trimmed.length === 0
      ? VALIDATION_COPY.category.empty
      : isEdit && !changed
        ? VALIDATION_COPY.nochange
        : undefined;

  return (
    <Sheet
      visible={visible}
      title={isEdit ? COPY.category.edit.title : COPY.category.new.title}
      onClose={onClose}
      testID="category-sheet"
    >
      <View style={styles.body}>
        <TextField
          testID={CATEGORY_NAME_TEST_ID}
          label={COPY.category.field.name}
          placeholder={COPY.category.field.namePlaceholder}
          value={name}
          onChangeText={onChangeName}
          onBlur={onBlurName}
          error={error}
          autoFocus
          autoCapitalize="sentences"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          // Hard cap from the contract's own limit, so the field cannot produce a name
          // `CategoryName` would reject. No error accompanies it: a limit that cannot be
          // exceeded does not need one (§2 rule 3).
          maxLength={LIMITS.CATEGORY_NAME_MAX}
        />

        {colourIsReserved ? (
          <ReservedColour hex={colour} />
        ) : (
          <ColourPicker selected={colour} onSelect={setColour} coloursInUse={coloursInUse} />
        )}

        <Button
          testID={CATEGORY_SUBMIT_TEST_ID}
          label={isEdit ? COPY.category.save : COPY.category.create}
          variant="primary"
          fullWidth
          onPress={submit}
          disabledReason={disabledReason}
        />

        {/* Edit mode only, and never on the `isDefault` row: offering an action that
            always fails is worse than not offering it (§1 rule 4, §3 rule 3). */}
        {onDelete === undefined ? null : (
          <Button
            testID={CATEGORY_DELETE_TEST_ID}
            label={COPY.category.delete}
            variant="ghost"
            tone="danger"
            fullWidth
            onPress={onDelete}
          />
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space[5],
    paddingBottom: space[4],
  },
});
