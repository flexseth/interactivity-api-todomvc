/**
 * Retrieves the translation of text.
 *
 * @see https://developer.wordpress.org/block-editor/reference-guides/packages/packages-i18n/
 */
import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * React hook for local component state.
 */
import { useState } from '@wordpress/element';

/**
 * Generates a unique id per block instance.
 */
import { useInstanceId } from '@wordpress/compose';

/**
 * React hook that is used to mark the block wrapper element.
 * It provides all the necessary props like the class name.
 *
 * @see https://developer.wordpress.org/block-editor/reference-guides/packages/packages-block-editor/#useblockprops
 */
import { useBlockProps } from '@wordpress/block-editor';

/**
 * Internal dependencies
 */
import {
	addTodo,
	clearCompleted,
	countLeft,
	removeTodo,
	toggleAll,
	updateTodo,
} from './todos';

/**
 * Lets webpack process CSS, SASS or SCSS files referenced in JavaScript files.
 * Those files can contain any CSS code that gets applied to the editor.
 *
 * @see https://www.npmjs.com/package/@wordpress/scripts#using-css
 */
import './editor.scss';

/**
 * The edit function describes the structure of your block in the context of the
 * editor. This represents what the editor will render when the block is used.
 *
 * Phase 1: plain, unstyled controls. The list lives in the `todos` attribute.
 *
 * @see https://developer.wordpress.org/block-editor/reference-guides/block-api/block-edit-save/#edit
 *
 * @param {Object}   props               Block props.
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Updates block attributes.
 * @return {Element} Element to render.
 */
export default function Edit( { attributes, setAttributes } ) {
	const { todos } = attributes;
	const [ draft, setDraft ] = useState( '' );
	const instanceId = useInstanceId( Edit, 'to-do-mvc' );

	const setTodos = ( next ) => setAttributes( { todos: next } );
	const left = countLeft( todos );
	const allCompleted = todos.length > 0 && left === 0;
	const hasCompleted = left < todos.length;

	return (
		<div { ...useBlockProps() }>
			<input
				type="text"
				value={ draft }
				placeholder={ __( 'What needs to be done?', 'to-do-mvc' ) }
				aria-label={ __( 'New to-do', 'to-do-mvc' ) }
				onChange={ ( event ) => setDraft( event.target.value ) }
				onKeyDown={ ( event ) => {
					if ( event.key !== 'Enter' ) {
						return;
					}
					event.preventDefault();
					setTodos( addTodo( todos, draft ) );
					setDraft( '' );
				} }
			/>

			{ todos.length > 0 && (
				<>
					<input
						type="checkbox"
						id={ `${ instanceId }-toggle-all` }
						checked={ allCompleted }
						onChange={ () => setTodos( toggleAll( todos ) ) }
					/>
					<label htmlFor={ `${ instanceId }-toggle-all` }>
						{ __( 'Mark all as complete', 'to-do-mvc' ) }
					</label>

					<ul>
						{ todos.map( ( todo ) => (
							<li key={ todo.id }>
								<input
									type="checkbox"
									checked={ todo.completed }
									aria-label={ __(
										'Completed',
										'to-do-mvc'
									) }
									onChange={ () =>
										setTodos(
											updateTodo( todos, todo.id, {
												completed: ! todo.completed,
											} )
										)
									}
								/>
								<input
									type="text"
									value={ todo.title }
									aria-label={ __(
										'To-do title',
										'to-do-mvc'
									) }
									onChange={ ( event ) =>
										setTodos(
											updateTodo( todos, todo.id, {
												title: event.target.value,
											} )
										)
									}
								/>
								<button
									type="button"
									onClick={ () =>
										setTodos( removeTodo( todos, todo.id ) )
									}
								>
									{ __( 'Delete', 'to-do-mvc' ) }
								</button>
							</li>
						) ) }
					</ul>

					<span>
						{ sprintf(
							/* translators: %d: number of to-dos left. */
							_n(
								'%d item left',
								'%d items left',
								left,
								'to-do-mvc'
							),
							left
						) }
					</span>

					{ hasCompleted && (
						<button
							type="button"
							onClick={ () =>
								setTodos( clearCompleted( todos ) )
							}
						>
							{ __( 'Clear completed', 'to-do-mvc' ) }
						</button>
					) }
				</>
			) }
		</div>
	);
}
