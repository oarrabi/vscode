/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import {KeyCode, KeyMod} from 'vs/base/common/keyCodes';
import {Disposable} from 'vs/base/common/lifecycle';
import {ContextKeyExpr, RawContextKey, IContextKey, IContextKeyService} from 'vs/platform/contextkey/common/contextkey';
import {Range} from 'vs/editor/common/core/range';
import {Selection} from 'vs/editor/common/core/selection';
import * as strings from 'vs/base/common/strings';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {editorAction, ServicesAccessor, EditorAction, EditorCommand, CommonEditorRegistry} from 'vs/editor/common/editorCommonExtensions';
import {FIND_IDS, FindModelBoundToEditorModel} from 'vs/editor/contrib/find/common/findModel';
import {FindReplaceState, FindReplaceStateChangedEvent, INewFindReplaceState} from 'vs/editor/contrib/find/common/findState';
import {DocumentHighlightProviderRegistry} from 'vs/editor/common/modes';
import {RunOnceScheduler} from 'vs/base/common/async';

import EditorContextKeys = editorCommon.EditorContextKeys;

export enum FindStartFocusAction {
	NoFocusChange,
	FocusFindInput,
	FocusReplaceInput
}

export interface IFindStartOptions {
	forceRevealReplace:boolean;
	seedSearchStringFromSelection:boolean;
	shouldFocus:FindStartFocusAction;
	shouldAnimate:boolean;
}

export const CONTEXT_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('findWidgetVisible', false);
export const CONTEXT_FIND_WIDGET_NOT_VISIBLE: ContextKeyExpr = CONTEXT_FIND_WIDGET_VISIBLE.toNegated();

export class CommonFindController extends Disposable implements editorCommon.IEditorContribution {

	private static ID = 'editor.contrib.findController';

	private _editor: editorCommon.ICommonCodeEditor;
	private _findWidgetVisible: IContextKey<boolean>;
	protected _state: FindReplaceState;
	private _model: FindModelBoundToEditorModel;

	static getFindController(editor:editorCommon.ICommonCodeEditor): CommonFindController {
		return <CommonFindController>editor.getContribution(CommonFindController.ID);
	}

	constructor(editor:editorCommon.ICommonCodeEditor, @IContextKeyService contextKeyService: IContextKeyService) {
		super();
		this._editor = editor;
		this._findWidgetVisible = CONTEXT_FIND_WIDGET_VISIBLE.bindTo(contextKeyService);

		this._state = this._register(new FindReplaceState());
		this._register(this._state.addChangeListener((e) => this._onStateChanged(e)));

		this._model = null;

		this._register(this._editor.onDidChangeModel(() => {
			let shouldRestartFind = (this._editor.getModel() && this._state.isRevealed);

			this.disposeModel();

			this._state.change({
				searchScope: null
			}, false);

			if (shouldRestartFind) {
				this._start({
					forceRevealReplace: false,
					seedSearchStringFromSelection: false,
					shouldFocus: FindStartFocusAction.NoFocusChange,
					shouldAnimate: false,
				});
			}
		}));
	}

	public dispose(): void {
		this.disposeModel();
		super.dispose();
	}

	private disposeModel(): void {
		if (this._model) {
			this._model.dispose();
			this._model = null;
		}
	}

	public getId(): string {
		return CommonFindController.ID;
	}

	private _onStateChanged(e:FindReplaceStateChangedEvent): void {
		if (e.isRevealed) {
			if (this._state.isRevealed) {
				this._findWidgetVisible.set(true);
			} else {
				this._findWidgetVisible.reset();
				this.disposeModel();
			}
		}
	}

	public getState(): FindReplaceState {
		return this._state;
	}

	public closeFindWidget(): void {
		this._state.change({
			isRevealed: false,
			searchScope: null
		}, false);
		this._editor.focus();
	}

	public toggleCaseSensitive(): void {
		this._state.change({ matchCase: !this._state.matchCase }, false);
	}

	public toggleWholeWords(): void {
		this._state.change({ wholeWord: !this._state.wholeWord }, false);
	}

	public toggleRegex(): void {
		this._state.change({ isRegex: !this._state.isRegex }, false);
	}

	public setSearchString(searchString:string): void {
		this._state.change({ searchString: searchString }, false);
	}

	public getSelectionSearchString(): string {
		let selection = this._editor.getSelection();

		if (selection.startLineNumber === selection.endLineNumber) {
			if (selection.isEmpty()) {
				let wordAtPosition = this._editor.getModel().getWordAtPosition(selection.getStartPosition());
				if (wordAtPosition) {
					return wordAtPosition.word;
				}
			} else {
				return this._editor.getModel().getValueInRange(selection);
			}
		}

		return null;
	}

	protected _start(opts:IFindStartOptions): void {
		this.disposeModel();

		if (!this._editor.getModel()) {
			// cannot do anything with an editor that doesn't have a model...
			return;
		}

		let stateChanges: INewFindReplaceState = {
			isRevealed: true
		};

		// Consider editor selection and overwrite the state with it
		if (opts.seedSearchStringFromSelection) {
			let selectionSearchString = this.getSelectionSearchString();
			if (selectionSearchString) {
				if (this._state.isRegex) {
					stateChanges.searchString = strings.escapeRegExpCharacters(selectionSearchString);
				} else {
					stateChanges.searchString = selectionSearchString;
				}
			}
		}

		// Overwrite isReplaceRevealed
		if (opts.forceRevealReplace) {
			stateChanges.isReplaceRevealed = true;
		}

		this._state.change(stateChanges, false);

		if (!this._model) {
			this._model = new FindModelBoundToEditorModel(this._editor, this._state);
		}
	}

	public start(opts:IFindStartOptions): void {
		this._start(opts);
	}

	public moveToNextMatch(): boolean {
		if (this._model) {
			this._model.moveToNextMatch();
			return true;
		}
		return false;
	}

	public moveToPrevMatch(): boolean {
		if (this._model) {
			this._model.moveToPrevMatch();
			return true;
		}
		return false;
	}

	public replace(): boolean {
		if (this._model) {
			this._model.replace();
			return true;
		}
		return false;
	}

	public replaceAll(): boolean {
		if (this._model) {
			this._model.replaceAll();
			return true;
		}
		return false;
	}

	public selectAllMatches(): boolean {
		if (this._model) {
			this._model.selectAllMatches();
			this._editor.focus();
			return true;
		}
		return false;
	}
}

@editorAction
export class StartFindAction extends EditorAction {

	constructor() {
		super({
			id: FIND_IDS.StartFindAction,
			label: nls.localize('startFindAction',"Find"),
			alias: 'Find',
			precondition: null,
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
				mac: {
					primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
					secondary: [KeyMod.CtrlCmd | KeyCode.KEY_E]
				}
			}
		});
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let controller = CommonFindController.getFindController(editor);
		controller.start({
			forceRevealReplace: false,
			seedSearchStringFromSelection: true,
			shouldFocus: FindStartFocusAction.FocusFindInput,
			shouldAnimate: true
		});
	}
}

export abstract class MatchFindAction extends EditorAction {
	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let controller = CommonFindController.getFindController(editor);
		if (!this._run(controller)) {
			controller.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: (controller.getState().searchString.length === 0),
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: true
			});
			this._run(controller);
		}
	}

	protected abstract _run(controller:CommonFindController): boolean;
}

@editorAction
export class NextMatchFindAction extends MatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.NextMatchFindAction,
			label: nls.localize('findNextMatchAction', "Find Next"),
			alias: 'Find Next',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_G, secondary: [KeyCode.F3] }
			}
		});
	}

	protected _run(controller:CommonFindController): boolean {
		return controller.moveToNextMatch();
	}
}

@editorAction
export class PreviousMatchFindAction extends MatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.PreviousMatchFindAction,
			label: nls.localize('findPreviousMatchAction', "Find Previous"),
			alias: 'Find Previous',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyMod.Shift | KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_G, secondary: [KeyMod.Shift | KeyCode.F3] }
			}
		});
	}

	protected _run(controller:CommonFindController): boolean {
		return controller.moveToPrevMatch();
	}
}

export abstract class SelectionMatchFindAction extends EditorAction {
	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let controller = CommonFindController.getFindController(editor);
		let selectionSearchString = controller.getSelectionSearchString();
		if (selectionSearchString) {
			controller.setSearchString(selectionSearchString);
		}
		if (!this._run(controller)) {
			controller.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: true
			});
			this._run(controller);
		}
	}

	protected abstract _run(controller:CommonFindController): boolean;
}

@editorAction
export class NextSelectionMatchFindAction extends SelectionMatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.NextSelectionMatchFindAction,
			label: nls.localize('nextSelectionMatchFindAction', "Find Next Selection"),
			alias: 'Find Next Selection',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyMod.CtrlCmd | KeyCode.F3
			}
		});
	}

	protected _run(controller:CommonFindController): boolean {
		return controller.moveToNextMatch();
	}
}

@editorAction
export class PreviousSelectionMatchFindAction extends SelectionMatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.PreviousSelectionMatchFindAction,
			label: nls.localize('previousSelectionMatchFindAction', "Find Previous Selection"),
			alias: 'Find Previous Selection',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.F3
			}
		});
	}

	protected _run(controller:CommonFindController): boolean {
		return controller.moveToPrevMatch();
	}
}

@editorAction
export class StartFindReplaceAction extends EditorAction {

	constructor() {
		super({
			id: FIND_IDS.StartFindReplaceAction,
			label: nls.localize('startReplace', "Replace"),
			alias: 'Replace',
			precondition: null,
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_H,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_F }
			}
		});
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		if (editor.getConfiguration().readOnly) {
			return;
		}

		let controller = CommonFindController.getFindController(editor);
		controller.start({
			forceRevealReplace: true,
			seedSearchStringFromSelection: true,
			shouldFocus: FindStartFocusAction.FocusReplaceInput,
			shouldAnimate: true
		});
	}
}

export interface IMultiCursorFindResult {
	searchText:string;
	matchCase:boolean;
	wholeWord:boolean;

	currentMatch: Selection;
}

function multiCursorFind(editor:editorCommon.ICommonCodeEditor, changeFindSearchString:boolean): IMultiCursorFindResult {
	let controller = CommonFindController.getFindController(editor);
	let state = controller.getState();
	let searchText: string;
	let currentMatch: Selection;

	// In any case, if the find widget was ever opened, the options are taken from it
	let wholeWord = state.wholeWord;
	let matchCase = state.matchCase;

	// Find widget owns what we search for if:
	//  - focus is not in the editor (i.e. it is in the find widget)
	//  - and the search widget is visible
	//  - and the search string is non-empty
	if (!editor.isFocused() && state.isRevealed && state.searchString.length > 0) {
		// Find widget owns what is searched for
		searchText = state.searchString;
	} else {
		// Selection owns what is searched for
		let s = editor.getSelection();

		if (s.startLineNumber !== s.endLineNumber) {
			// Cannot search for multiline string... yet...
			return null;
		}

		if (s.isEmpty()) {
			// selection is empty => expand to current word
			let word = editor.getModel().getWordAtPosition(s.getStartPosition());
			if (!word) {
				return null;
			}
			searchText = word.word;
			currentMatch = new Selection(s.startLineNumber, word.startColumn, s.startLineNumber, word.endColumn);
		} else {
			searchText = editor.getModel().getValueInRange(s);
		}
		if (changeFindSearchString) {
			controller.setSearchString(searchText);
		}
	}

	return {
		searchText: searchText,
		matchCase: matchCase,
		wholeWord: wholeWord,
		currentMatch: currentMatch
	};
}

export abstract class SelectNextFindMatchAction extends EditorAction {
	protected _getNextMatch(editor:editorCommon.ICommonCodeEditor): Selection {
		let r = multiCursorFind(editor, true);
		if (!r) {
			return null;
		}
		if (r.currentMatch) {
			return r.currentMatch;
		}

		let allSelections = editor.getSelections();
		let lastAddedSelection = allSelections[allSelections.length - 1];

		let nextMatch = editor.getModel().findNextMatch(r.searchText, lastAddedSelection.getEndPosition(), false, r.matchCase, r.wholeWord);

		if (!nextMatch) {
			return null;
		}

		return new Selection(nextMatch.startLineNumber, nextMatch.startColumn, nextMatch.endLineNumber, nextMatch.endColumn);
	}
}

export abstract class SelectPreviousFindMatchAction extends EditorAction {
	protected _getPreviousMatch(editor:editorCommon.ICommonCodeEditor): Selection {
		let r = multiCursorFind(editor, true);
		if (!r) {
			return null;
		}
		if (r.currentMatch) {
			return r.currentMatch;
		}

		let allSelections = editor.getSelections();
		let lastAddedSelection = allSelections[allSelections.length - 1];

		let previousMatch = editor.getModel().findPreviousMatch(r.searchText, lastAddedSelection.getStartPosition(), false, r.matchCase, r.wholeWord);

		if (!previousMatch) {
			return null;
		}

		return new Selection(previousMatch.startLineNumber, previousMatch.startColumn, previousMatch.endLineNumber, previousMatch.endColumn);
	}
}

@editorAction
export class AddSelectionToNextFindMatchAction extends SelectNextFindMatchAction {

	constructor() {
		super({
			id: FIND_IDS.AddSelectionToNextFindMatchAction,
			label: nls.localize('addSelectionToNextFindMatch', "Add Selection To Next Find Match"),
			alias: 'Add Selection To Next Find Match',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_D
			}
		});
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let nextMatch = this._getNextMatch(editor);

		if (!nextMatch) {
			return;
		}

		let allSelections = editor.getSelections();
		editor.setSelections(allSelections.concat(nextMatch));
		editor.revealRangeInCenterIfOutsideViewport(nextMatch);
	}
}

@editorAction
export class AddSelectionToPreviousFindMatchAction extends SelectPreviousFindMatchAction {

	constructor() {
		super({
			id: FIND_IDS.AddSelectionToPreviousFindMatchAction,
			label: nls.localize('addSelectionToPreviousFindMatch', "Add Selection To Previous Find Match"),
			alias: 'Add Selection To Previous Find Match',
			precondition: null
		});
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let previousMatch = this._getPreviousMatch(editor);

		if (!previousMatch) {
			return;
		}

		let allSelections = editor.getSelections();
		editor.setSelections(allSelections.concat(previousMatch));
		editor.revealRangeInCenterIfOutsideViewport(previousMatch);
	}
}

@editorAction
export class MoveSelectionToNextFindMatchAction extends SelectNextFindMatchAction {

	constructor() {
		super({
			id: FIND_IDS.MoveSelectionToNextFindMatchAction,
			label: nls.localize('moveSelectionToNextFindMatch', "Move Last Selection To Next Find Match"),
			alias: 'Move Last Selection To Next Find Match',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_D)
			}
		});
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let nextMatch = this._getNextMatch(editor);

		if (!nextMatch) {
			return;
		}

		let allSelections = editor.getSelections();
		editor.setSelections(allSelections.slice(0, allSelections.length - 1).concat(nextMatch));
		editor.revealRangeInCenterIfOutsideViewport(nextMatch);
	}
}

@editorAction
export class MoveSelectionToPreviousFindMatchAction extends SelectPreviousFindMatchAction {

	constructor() {
		super({
			id: FIND_IDS.MoveSelectionToPreviousFindMatchAction,
			label: nls.localize('moveSelectionToPreviousFindMatch', "Move Last Selection To Previous Find Match"),
			alias: 'Move Last Selection To Previous Find Match',
			precondition: null
		});
	}

	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let previousMatch = this._getPreviousMatch(editor);

		if (!previousMatch) {
			return;
		}

		let allSelections = editor.getSelections();
		editor.setSelections(allSelections.slice(0, allSelections.length - 1).concat(previousMatch));
		editor.revealRangeInCenterIfOutsideViewport(previousMatch);
	}
}

export abstract class AbstractSelectHighlightsAction extends EditorAction {
	public run(accessor:ServicesAccessor, editor:editorCommon.ICommonCodeEditor): void {
		let r = multiCursorFind(editor, true);
		if (!r) {
			return;
		}

		let matches = editor.getModel().findMatches(r.searchText, true, false, r.matchCase, r.wholeWord);

		if (matches.length > 0) {
			let editorSelection = editor.getSelection();
			for (let i = 0, len = matches.length; i < len; i++) {
				let match = matches[i];
				let intersection = match.intersectRanges(editorSelection);
				if (intersection) {
					// bingo!
					matches.splice(i, 1);
					matches.unshift(match);
					break;
				}
			}
			editor.setSelections(matches.map(m => new Selection(m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn)));
		}
	}
}

@editorAction
export class SelectHighlightsAction extends AbstractSelectHighlightsAction {
	constructor() {
		super({
			id: 'editor.action.selectHighlights',
			label: nls.localize('selectAllOccurencesOfFindMatch', "Select All Occurences of Find Match"),
			alias: 'Select All Occurences of Find Match',
			precondition: null,
			kbOpts: {
				kbExpr: EditorContextKeys.Focus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_L
			}
		});
	}
}

@editorAction
export class CompatChangeAll extends AbstractSelectHighlightsAction {
	constructor() {
		super({
			id: 'editor.action.changeAll',
			label: nls.localize('changeAll.label', "Change All Occurrences"),
			alias: 'Change All Occurrences',
			precondition: EditorContextKeys.Writable,
			kbOpts: {
				kbExpr: EditorContextKeys.TextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.F2
			},
			menuOpts: {
				group: '1_modification',
				order: 1.2
			}
		});
	}
}

export class SelectionHighlighter extends Disposable implements editorCommon.IEditorContribution {
	private static ID = 'editor.contrib.selectionHighlighter';

	private editor: editorCommon.ICommonCodeEditor;
	private decorations: string[];
	private updateSoon: RunOnceScheduler;
	private lastWordUnderCursor: Range;

	constructor(editor:editorCommon.ICommonCodeEditor) {
		super();
		this.editor = editor;
		this.decorations = [];
		this.updateSoon = this._register(new RunOnceScheduler(() => this._update(), 300));
		this.lastWordUnderCursor = null;

		this._register(editor.onDidChangeCursorSelection((e: editorCommon.ICursorSelectionChangedEvent) => {
			if (e.selection.isEmpty()) {
				if (e.reason === editorCommon.CursorChangeReason.Explicit) {
					if (!this.lastWordUnderCursor || !this.lastWordUnderCursor.containsPosition(e.selection.getStartPosition())) {
						// no longer valid
						this.removeDecorations();
					}
					this.updateSoon.schedule();
				} else {
					this.removeDecorations();

				}
			} else {
				this._update();
			}
		}));
		this._register(editor.onDidChangeModel((e) => {
			this.removeDecorations();
		}));
		this._register(CommonFindController.getFindController(editor).getState().addChangeListener((e) => {
			this._update();
		}));
	}

	public getId(): string {
		return SelectionHighlighter.ID;
	}

	private removeDecorations(): void {
		this.lastWordUnderCursor = null;
		if (this.decorations.length > 0) {
			this.decorations = this.editor.deltaDecorations(this.decorations, []);
		}
	}

	private _update(): void {
		let model = this.editor.getModel();
		if (!model) {
			return;
		}

		this.lastWordUnderCursor = null;
		if (!this.editor.getConfiguration().contribInfo.selectionHighlight) {
			return;
		}

		let r = multiCursorFind(this.editor, false);
		if (!r) {
			this.removeDecorations();
			return;
		}

		let hasFindOccurences = DocumentHighlightProviderRegistry.has(model);
		if (r.currentMatch) {
			// This is an empty selection
			if (hasFindOccurences) {
				// Do not interfere with semantic word highlighting in the no selection case
				this.removeDecorations();
				return;
			}

			this.lastWordUnderCursor = r.currentMatch;
		}
		if (/^[ \t]+$/.test(r.searchText)) {
			// whitespace only selection
			this.removeDecorations();
			return;
		}
		if (r.searchText.length > 200) {
			// very long selection
			this.removeDecorations();
			return;
		}
		let selections = this.editor.getSelections();
		let firstSelectedText = model.getValueInRange(selections[0]);
		for (let i = 1; i < selections.length; i++) {
			let selectedText = model.getValueInRange(selections[i]);
			if (firstSelectedText !== selectedText) {
				// not all selections have the same text
				this.removeDecorations();
				return;
			}
		}


		let allMatches = model.findMatches(r.searchText, true, false, r.matchCase, r.wholeWord);
		allMatches.sort(Range.compareRangesUsingStarts);

		selections.sort(Range.compareRangesUsingStarts);

		// do not overlap with selection (issue #64 and #512)
		let matches: Range[] = [];
		for (let i = 0, j = 0, len = allMatches.length, lenJ = selections.length; i < len; ) {
			let match = allMatches[i];

			if (j >= lenJ) {
				// finished all editor selections
				matches.push(match);
				i++;
			} else {
				let cmp = Range.compareRangesUsingStarts(match, selections[j]);
				if (cmp < 0) {
					// match is before sel
					matches.push(match);
					i++;
				} else if (cmp > 0) {
					// sel is before match
					j++;
				} else {
					// sel is equal to match
					i++;
					j++;
				}
			}
		}

		let decorations = matches.map(r => {
			return {
				range: r,
				options: {
					stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					className: 'selectionHighlight',
					// Show in overviewRuler only if model has no semantic highlighting
					overviewRuler: (hasFindOccurences ? undefined : {
						color: '#A0A0A0',
						darkColor: '#A0A0A0',
						position: editorCommon.OverviewRulerLane.Center
					})
				}
			};
		});

		this.decorations = this.editor.deltaDecorations(this.decorations, decorations);
	}

	public dispose(): void {
		this.removeDecorations();
		super.dispose();
	}
}

const FindCommand = EditorCommand.bindToContribution<CommonFindController>(CommonFindController.getFindController);

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.CloseFindWidgetCommand,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.closeFindWidget(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleCaseSensitiveCommand,
	precondition: null,
	handler: x => x.toggleCaseSensitive(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyMod.Alt | KeyCode.KEY_C,
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_C }
	}
}));

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleWholeWordCommand,
	precondition: null,
	handler: x => x.toggleWholeWords(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyMod.Alt | KeyCode.KEY_W,
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_W }
	}
}));

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleRegexCommand,
	precondition: null,
	handler: x => x.toggleRegex(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyMod.Alt | KeyCode.KEY_R,
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_R }
	}
}));

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.ReplaceOneAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.replace(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_1
	}
}));

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.ReplaceAllAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.replaceAll(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter
	}
}));

CommonEditorRegistry.registerEditorCommand(new FindCommand({
	id: FIND_IDS.SelectAllMatchesAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.selectAllMatches(),
	kbOpts: {
		weight: CommonEditorRegistry.commandWeight(5),
		kbExpr: EditorContextKeys.Focus,
		primary: KeyMod.Alt | KeyCode.Enter
	}
}));
